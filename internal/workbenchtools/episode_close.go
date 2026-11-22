package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"WWorkbench/internal/notebook"
	"WWorkbench/internal/workbench"
)

const episodeOfferDedupTTL = 3 * time.Minute

// EmitEpisodeClose 向前端推送成长卡（mcp:episode_close）。
func (g *MCPConfirmGate) EmitEpisodeClose(ep LearningEpisode) {
	if g == nil || g.emit == nil {
		return
	}
	if strings.TrimSpace(ep.ID) == "" {
		return
	}
	if len(ep.PendingLessons) == 0 && len(ep.TrustFingerprints) == 0 {
		return
	}
	choices := make([]map[string]interface{}, 0, len(ep.PendingLessons))
	for _, les := range ep.PendingLessons {
		label := firstNonEmpty(les.HumanLabel, humanizeLessonLabel(les.Lessons, les.Kind))
		choices = append(choices, map[string]interface{}{
			"id":             les.ID,
			"label":          label,
			"kind":           les.Kind,
			"defaultChecked": true,
			"detail":         truncateRunes(les.Lessons, 120),
		})
	}
	benefit := "下次同类事少问你 " + itoa(len(ep.PendingLessons)) + " 次"
	if len(ep.PendingLessons) == 0 {
		benefit = "本回合已有信任沉淀；可跳过或确认收口"
	}
	payload := map[string]interface{}{
		"episodeId":   ep.ID,
		"projectId":   ep.ProjectID,
		"intent":      ep.Intent,
		"skillPath":   ep.SkillPath,
		"status":      ep.Status,
		"choices":     choices,
		"trustCount":  len(ep.TrustFingerprints),
		"pendingCount": len(ep.PendingLessons),
		"title":       "本回合可记住这些",
		"benefit":     benefit,
		"offerPrompt": "勾选要写进项目 Skill 的条目；跳过则本回合不沉淀经验。",
		"restoreHint": "写错可在设置里撤销信任，或用 Skill 版本 pin/restore 回退。",
		"at":          time.Now().UnixMilli(),
	}
	g.emit("mcp:episode_close", payload)
}

// OfferEpisodeClose 标记 offered 并推成长卡；dedup 避免连环弹。
func OfferEpisodeClose(d *Deps, episodeID string, force bool) (LearningEpisode, bool) {
	if d == nil || d.Episodes == nil {
		return LearningEpisode{}, false
	}
	ep, ok := d.Episodes.Get(episodeID)
	if !ok {
		return LearningEpisode{}, false
	}
	if !force && ep.Status == episodeStatusOffered && ep.OfferedAt > 0 {
		if time.Since(time.UnixMilli(ep.OfferedAt)) < episodeOfferDedupTTL {
			return ep, false
		}
	}
	if len(ep.PendingLessons) == 0 && len(ep.TrustFingerprints) == 0 {
		return ep, false
	}
	ep, ok = d.Episodes.MarkOffered(ep.ID)
	if !ok {
		return LearningEpisode{}, false
	}
	if d.MCPConfirm != nil {
		d.MCPConfirm.EmitEpisodeClose(ep)
		n := len(ep.PendingLessons)
		label := "回合进行中"
		if n > 0 {
			label = "回合可沉淀 · " + itoa(n) + " 条"
		}
		d.MCPConfirm.EmitStage("episode", label, ep.Intent, ep.SkillPath, "episode_close")
	}
	return ep, true
}

// MaybeQueueEpisodeLesson 里程碑 suggestedSkill → 入回合 pending，不立刻 skill_offer。
// 收口条件满足时弹一张成长卡。
func MaybeQueueEpisodeLesson(d *Deps, tool string, args json.RawMessage, res ToolResult) {
	if d == nil || d.Episodes == nil || !res.OK {
		return
	}
	sk, ok := extractSuggestedSkill(res.Data)
	if !ok || !sk.AskHuman {
		return
	}
	lessons := strings.TrimSpace(sk.Lessons)
	if lessons == "" {
		return
	}
	intent := strings.TrimSpace(extractIntent(args))
	projectID, skillPath := resolveActiveProjectSkill(d)
	if skillPath == "" {
		skillPath = strings.TrimSpace(sk.Name)
	}
	if projectID == "" && skillPath == "" {
		// 无项目且无 skill 名：退回旧 skill_offer，避免丢沉淀
		if d.MCPConfirm != nil {
			d.MCPConfirm.EmitSkillOffer(tool, sk)
		}
		return
	}

	human := humanizeLessonLabel(lessons, "lesson")
	if prompt := strings.TrimSpace(sk.OfferPrompt); prompt != "" && !strings.Contains(prompt, "fingerprint") {
		human = truncateRunes(strings.TrimSuffix(prompt, "吗？"), 48)
	}
	ep := d.Episodes.AppendLesson(projectID, intent, skillPath, EpisodePendingLesson{
		Kind:       "lesson",
		HumanLabel: human,
		Lessons:    lessons,
		Tool:       tool,
		Domain:     sk.Domain,
	})
	if d.MCPConfirm != nil {
		n := len(ep.PendingLessons)
		d.MCPConfirm.EmitStage("episode", "回合进行中 · 可沉淀 "+itoa(n)+" 条", intent, skillPath, tool)
	}

	shouldOffer := looksLikeGoalClose(intent) || len(ep.PendingLessons) >= 3
	if shouldOffer {
		OfferEpisodeClose(d, ep.ID, false)
	}
}

// CloseLearningEpisode 人审收口：选中 lessons 写入 Skill，回合标记 closed/skipped。
func CloseLearningEpisode(d *Deps, episodeID string, selectedIDs []string, skip bool) ToolResult {
	if d == nil || d.Episodes == nil {
		return Fail("回合账本未就绪")
	}
	ep, ok := d.Episodes.Get(episodeID)
	if !ok {
		return Fail("回合不存在")
	}
	if skip {
		closed, ok := d.Episodes.Close(episodeID, nil, true)
		if !ok {
			return Fail("跳过失败")
		}
		if d.MCPConfirm != nil {
			d.MCPConfirm.EmitStage("episode", "已跳过本回合沉淀", closed.Intent, closed.SkillPath, "episode_close")
		}
		return OKData(map[string]interface{}{
			"ok":        true,
			"skipped":   true,
			"episodeId": closed.ID,
			"status":    closed.Status,
		})
	}

	// 显式勾选：空 selectedIds = 不写经验（仍可收口）；非空才过滤写入。
	var toWrite []EpisodePendingLesson
	if len(selectedIDs) > 0 {
		toWrite = d.Episodes.PendingLessonsForClose(episodeID, selectedIDs)
	}
	skillPath := strings.TrimSpace(ep.SkillPath)
	if skillPath == "" {
		_, skillPath = resolveActiveProjectSkill(d)
	}
	written := 0
	var notes []string
	var writtenParts []string
	preWriteBase := ""
	if skillPath != "" && len(toWrite) > 0 {
		var parts []string
		for _, les := range toWrite {
			if strings.TrimSpace(les.Lessons) != "" {
				parts = append(parts, les.Lessons)
			}
		}
		joined := strings.Join(parts, "\n\n")
		if joined != "" {
			// 写前快照：供 harness 评测新颖度，避免把刚写入的补丁判成重复。
			if d.Notebook != nil {
				if note, err := d.Notebook.GetNote(notebook.SkillNoteID(skillPath)); err == nil && note != nil {
					preWriteBase = notebook.ExtractWorkflowNoteBodyExtras(note.Content).Lessons
				}
			}
			res := UpdateSkillNow(d, UpdateSkillArgs{
				Name:    skillPath,
				Intent:  "回合收口沉淀：" + firstNonEmpty(ep.Intent, episodeID),
				Lessons: joined,
			})
			if res.OK {
				written = len(parts)
				writtenParts = parts
				notes = append(notes, "已写入 Skill · "+skillPath)
			} else {
				notes = append(notes, "Skill 写入失败："+res.Error)
			}
		}
	}

	closed, ok := d.Episodes.Close(episodeID, selectedIDs, false)
	if !ok {
		return Fail("收口失败")
	}
	if d.MCPConfirm != nil {
		label := "本回合已收口"
		if written > 0 {
			label = "已沉淀 " + itoa(written) + " 条 · 下次少问"
		}
		d.MCPConfirm.EmitStage("episode", label, closed.Intent, skillPath, "episode_close")
	}
	out := map[string]interface{}{
		"ok":          true,
		"episodeId":   closed.ID,
		"status":      closed.Status,
		"written":     written,
		"skillPath":   skillPath,
		"notes":       notes,
		"pendingLeft": len(closed.PendingLessons),
	}
	// 浏览器宏域：收口写盘后自动提出 harness 进化候选（shadow → 人审升版）。
	if cand := MaybeProposeHarnessAfterEpisode(d, closed.ID, skillPath, writtenParts, preWriteBase); cand != nil {
		out["harnessCandidateId"] = cand.ID
		out["harnessScore"] = 0
		if cand.Score != nil {
			out["harnessScore"] = cand.Score.Total
		}
		notes = append(notes, "已提出 harness 进化候选 · "+cand.ID)
		out["notes"] = notes
	}
	return OKData(out)
}

func toolOfferEpisodeClose(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		EpisodeID string `json:"episodeId"`
		ProjectID string `json:"projectId"`
		Intent    string `json:"intent"`
		Force     bool   `json:"force"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.EpisodeID)
	if id == "" && d != nil && d.Episodes != nil {
		projectID := strings.TrimSpace(in.ProjectID)
		if projectID == "" {
			projectID, _ = resolveActiveProjectSkill(d)
		}
		opens := d.Episodes.ListOpen(projectID, 1)
		if len(opens) > 0 {
			id = opens[0].ID
		} else if intent := strings.TrimSpace(in.Intent); intent != "" {
			ep := d.Episodes.Touch(projectID, intent, "", "")
			id = ep.ID
		}
	}
	if id == "" {
		return Fail("无未收口回合；传 episodeId 或先完成带 intent 的里程碑")
	}
	ep, ok := OfferEpisodeClose(d, id, in.Force)
	if !ok {
		return OKData(map[string]interface{}{
			"ok":        true,
			"offered":   false,
			"episodeId": id,
			"note":      "无可沉淀条目或近期已弹过成长卡",
		})
	}
	return OKData(map[string]interface{}{
		"ok":           true,
		"offered":      true,
		"episodeId":    ep.ID,
		"pendingCount": len(ep.PendingLessons),
		"trustCount":   len(ep.TrustFingerprints),
		"skillPath":    ep.SkillPath,
		"note":         "已推成长卡；人勾选后 close_learning_episode",
	})
}

func toolCloseLearningEpisode(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		EpisodeID   string   `json:"episodeId"`
		SelectedIDs []string `json:"selectedIds"`
		Skip        bool     `json:"skip"`
		Intent      string   `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	if strings.TrimSpace(in.EpisodeID) == "" {
		return Fail("episodeId 不能为空")
	}
	_ = in.Intent
	return CloseLearningEpisode(d, in.EpisodeID, in.SelectedIDs, in.Skip)
}

func registerEpisodeTools(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapOfferEpisodeClose,
		Description: "弹出本回合成长卡（人审一次写入 Skill）。里程碑默认只入队 pendingLessons；" +
			"目标完成或人点收口时调用。无 episodeId 则取当前项目最近未收口回合。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"episodeId": map[string]interface{}{"type": "string", "description": "回合 id"},
				"projectId": map[string]interface{}{"type": "string", "description": "项目 id（省略则用当前舞台项目）"},
				"intent":    map[string]interface{}{"type": "string", "description": "可选；无 open 回合时用于 Touch"},
				"force":     map[string]interface{}{"type": "boolean", "description": "忽略近期已弹过的去重"},
			},
		},
		Handler: toolOfferEpisodeClose,
	})
	r.add(ToolDef{
		Name: workbench.CapCloseLearningEpisode,
		Description: "人审收口：selectedIds 写入项目 Skill（## 经验），回合标记 closed；skip=true 跳过沉淀。" +
			"前端成长卡确认后也会调本工具。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"episodeId":   map[string]interface{}{"type": "string", "description": "回合 id"},
				"selectedIds": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "勾选的 pending lesson id"},
				"skip":        map[string]interface{}{"type": "boolean", "description": "跳过本回合沉淀"},
				"intent":      map[string]interface{}{"type": "string", "description": "人话意图（审计）"},
			},
			"required": []string{"episodeId"},
		},
		Handler: toolCloseLearningEpisode,
	})
}

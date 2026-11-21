package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"WWorkbench/internal/notebook"
	"WWorkbench/internal/store"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

const (
	harnessCandidatesSettingKey = "harness_rsi_candidates"
	harnessStatusProposed       = "proposed"
	harnessStatusEvaluated      = "evaluated"
	harnessStatusPromoted       = "promoted"
	harnessStatusDiscarded      = "discarded"
	harnessStatusFrozen         = "frozen"
	maxHarnessCandidatesKept    = 60
	harnessPromoteMinScore      = 55
)

// HarnessCandidate Skill 进化候选（shadow，默认不进 learningDigest）。
type HarnessCandidate struct {
	ID           string             `json:"id"`
	EpisodeID    string             `json:"episodeId,omitempty"`
	ProjectID    string             `json:"projectId,omitempty"`
	SkillPath    string             `json:"skillPath"`
	Domain       string             `json:"domain,omitempty"`
	Status       string             `json:"status"`
	LessonsPatch string             `json:"lessonsPatch"`
	Summary      string             `json:"summary"`
	BaseLessons  string             `json:"baseLessons,omitempty"`
	Score        *HarnessEvalScore  `json:"score,omitempty"`
	CreatedAt    int64              `json:"createdAt"`
	UpdatedAt    int64              `json:"updatedAt"`
	PromotedAt   int64              `json:"promotedAt,omitempty"`
}

// HarnessEvalScore 静态评测分（0–100）+ 细项。
type HarnessEvalScore struct {
	Total      int      `json:"total"`
	Breakdown  []string `json:"breakdown,omitempty"`
	Pass       bool     `json:"pass"`
	EvaluatedAt int64   `json:"evaluatedAt"`
}

// HarnessCandidateBook 候选持久化。
type HarnessCandidateBook struct {
	mu    sync.RWMutex
	items []HarnessCandidate
	store *store.Store
}

// NewHarnessCandidateBook 从设置加载。
func NewHarnessCandidateBook(st *store.Store) *HarnessCandidateBook {
	b := &HarnessCandidateBook{store: st}
	b.load()
	return b
}

func (b *HarnessCandidateBook) load() {
	if b == nil || b.store == nil {
		return
	}
	raw, err := b.store.GetAppSetting(harnessCandidatesSettingKey)
	if err != nil || strings.TrimSpace(raw) == "" {
		return
	}
	var items []HarnessCandidate
	if json.Unmarshal([]byte(raw), &items) != nil {
		return
	}
	b.mu.Lock()
	b.items = items
	b.mu.Unlock()
}

func (b *HarnessCandidateBook) persistLocked() {
	if b == nil || b.store == nil {
		return
	}
	if len(b.items) > maxHarnessCandidatesKept {
		b.items = b.items[:maxHarnessCandidatesKept]
	}
	raw, _ := json.Marshal(b.items)
	_ = b.store.SetAppSetting(harnessCandidatesSettingKey, string(raw))
}

func (b *HarnessCandidateBook) Get(id string) (HarnessCandidate, bool) {
	if b == nil {
		return HarnessCandidate{}, false
	}
	id = strings.TrimSpace(id)
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, it := range b.items {
		if it.ID == id {
			return it, true
		}
	}
	return HarnessCandidate{}, false
}

func (b *HarnessCandidateBook) List(skillPath string, limit int) []HarnessCandidate {
	if b == nil {
		return nil
	}
	if limit <= 0 {
		limit = 20
	}
	skillPath = strings.TrimSpace(skillPath)
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]HarnessCandidate, 0, limit)
	for _, it := range b.items {
		if skillPath != "" && it.SkillPath != skillPath {
			continue
		}
		if it.Status == harnessStatusDiscarded || it.Status == harnessStatusPromoted {
			continue
		}
		out = append(out, it)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func (b *HarnessCandidateBook) Add(c HarnessCandidate) HarnessCandidate {
	if b == nil {
		return c
	}
	now := time.Now().UnixMilli()
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.Status == "" {
		c.Status = harnessStatusProposed
	}
	c.CreatedAt = now
	c.UpdatedAt = now
	b.mu.Lock()
	defer b.mu.Unlock()
	b.items = append([]HarnessCandidate{c}, b.items...)
	b.persistLocked()
	return c
}

func (b *HarnessCandidateBook) Update(c HarnessCandidate) bool {
	if b == nil {
		return false
	}
	id := strings.TrimSpace(c.ID)
	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.items {
		if b.items[i].ID == id {
			c.UpdatedAt = time.Now().UnixMilli()
			b.items[i] = c
			b.persistLocked()
			return true
		}
	}
	return false
}

func registerHarnessRSITools(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapProposeHarnessPatch,
		Description: "从回合/经验生成 Skill 进化候选（shadow，不直接写盘）。" +
			"浏览器宏域优先：把稳定 browser_run 路径提炼成 lessons 补丁。人审后 eval → promote。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"episodeId":    map[string]interface{}{"type": "string"},
				"skillPath":    map[string]interface{}{"type": "string", "description": "项目/… 或 工作流/…"},
				"lessonsPatch": map[string]interface{}{"type": "string", "description": "候选经验补丁；空则从 episode 待沉淀拼"},
				"domain":       map[string]interface{}{"type": "string", "description": "browser|ops|desktop；默认 browser"},
				"intent":       intentProp(),
			},
		},
		Handler: toolProposeHarnessPatch,
	})
	r.add(ToolDef{
		Name: workbench.CapEvalHarnessCandidate,
		Description: "静态评测 harness 候选（结构/宏提示/新颖度/体量），写出 score；" +
			"≥55 可 promote。不改线上 Skill。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"candidateId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"candidateId"},
		},
		Handler: toolEvalHarnessCandidate,
	})
	r.add(ToolDef{
		Name: workbench.CapPromoteHarnessCandidate,
		Description: "人确认后升版：pin → update_skill(lessons=补丁) → 标记 promoted。" +
			"默认要求已 eval 且 score≥55；force=true 可强升。禁止改系统规则。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"candidateId": map[string]interface{}{"type": "string"},
				"force":       map[string]interface{}{"type": "boolean"},
				"intent":      intentProp(),
			},
			"required": []interface{}{"candidateId", "intent"},
		},
		Handler: toolPromoteHarnessCandidate,
	})
	r.add(ToolDef{
		Name:        workbench.CapDiscardHarnessCandidate,
		Description: "丢弃或冻结 harness 候选（不写 Skill）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"candidateId": map[string]interface{}{"type": "string"},
				"freeze":      map[string]interface{}{"type": "boolean", "description": "true=冻结不再自动提案同 skill"},
			},
			"required": []interface{}{"candidateId"},
		},
		Handler: toolDiscardHarnessCandidate,
	})
	r.add(ToolDef{
		Name:        workbench.CapListHarnessCandidates,
		Description: "列出未升版/未丢弃的 harness 候选（可按 skillPath 过滤）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"skillPath": map[string]interface{}{"type": "string"},
				"limit":     map[string]interface{}{"type": "integer"},
			},
		},
		Handler: toolListHarnessCandidates,
	})
}

func toolProposeHarnessPatch(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		EpisodeID    string `json:"episodeId"`
		SkillPath    string `json:"skillPath"`
		LessonsPatch string `json:"lessonsPatch"`
		Domain       string `json:"domain"`
		Intent       string `json:"intent"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	return ProposeHarnessPatch(d, ProposeHarnessArgs{
		EpisodeID:    strings.TrimSpace(in.EpisodeID),
		SkillPath:    strings.TrimSpace(in.SkillPath),
		LessonsPatch: strings.TrimSpace(in.LessonsPatch),
		Domain:       strings.TrimSpace(in.Domain),
		Intent:       strings.TrimSpace(in.Intent),
		EmitUI:       true,
	})
}

func toolEvalHarnessCandidate(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		CandidateID string `json:"candidateId"`
	}
	_ = json.Unmarshal(raw, &in)
	return EvalHarnessCandidate(d, strings.TrimSpace(in.CandidateID))
}

func toolPromoteHarnessCandidate(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		CandidateID string `json:"candidateId"`
		Force       bool   `json:"force"`
		Intent      string `json:"intent"`
	}
	_ = json.Unmarshal(raw, &in)
	return PromoteHarnessCandidate(d, strings.TrimSpace(in.CandidateID), strings.TrimSpace(in.Intent), in.Force)
}

func toolDiscardHarnessCandidate(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		CandidateID string `json:"candidateId"`
		Freeze      bool   `json:"freeze"`
	}
	_ = json.Unmarshal(raw, &in)
	return DiscardHarnessCandidate(d, strings.TrimSpace(in.CandidateID), in.Freeze)
}

func toolListHarnessCandidates(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		SkillPath string `json:"skillPath"`
		Limit     int    `json:"limit"`
	}
	_ = json.Unmarshal(raw, &in)
	if d == nil || d.Harness == nil {
		return Fail("harness 账本未就绪")
	}
	items := d.Harness.List(in.SkillPath, in.Limit)
	return OKData(map[string]interface{}{"ok": true, "candidates": items, "count": len(items)})
}

// ProposeHarnessArgs 生成候选。
type ProposeHarnessArgs struct {
	EpisodeID    string
	SkillPath    string
	LessonsPatch string
	Domain       string
	Intent       string
	EmitUI       bool
}

// ProposeHarnessPatch 创建 shadow 候选；浏览器宏域默认。
func ProposeHarnessPatch(d *Deps, in ProposeHarnessArgs) ToolResult {
	if d == nil || d.Harness == nil {
		return Fail("harness 账本未就绪")
	}
	skillPath := strings.TrimSpace(in.SkillPath)
	projectID := ""
	patch := strings.TrimSpace(in.LessonsPatch)
	domain := strings.TrimSpace(in.Domain)
	if domain == "" {
		domain = "browser"
	}

	var ep LearningEpisode
	if id := strings.TrimSpace(in.EpisodeID); id != "" && d.Episodes != nil {
		if got, ok := d.Episodes.Get(id); ok {
			ep = got
			if skillPath == "" {
				skillPath = got.SkillPath
			}
			projectID = got.ProjectID
			if patch == "" {
				var parts []string
				for _, les := range got.PendingLessons {
					if strings.TrimSpace(les.Lessons) != "" {
						parts = append(parts, les.Lessons)
					}
					if domain == "browser" && (les.Domain == "browser" || strings.Contains(les.Lessons, "browser_run")) {
						domain = "browser"
					}
				}
				patch = strings.Join(parts, "\n\n")
			}
		}
	}
	if skillPath == "" {
		projectID, skillPath = resolveActiveProjectSkill(d)
	}
	if skillPath == "" {
		return FailTeach("缺少 skillPath", Teach{
			Summary:   "无法提案：没有目标 Skill",
			NextSteps: []string{"打开项目舞台或传 skillPath=项目/…", "先完成回合沉淀再 propose"},
		})
	}
	if patch == "" {
		return FailTeach("缺少 lessonsPatch", Teach{
			Summary:   "没有可进化的经验补丁",
			NextSteps: []string{"先跑通浏览器宏并收口成长卡", "或手动传 lessonsPatch"},
		})
	}
	if !looksLikeHarnessablePatch(domain, patch) {
		return FailTeach("补丁不像可进化的 harness 内容", Teach{
			Summary: "当前切片只接受浏览器宏相关经验",
			NextSteps: []string{
				"补丁须含 browser_run / 宏 / 网页路径等信号",
				"运维/桌面域后续再开切片",
			},
		})
	}
	if frozenSkill(d, skillPath) {
		return FailTeach("该 Skill 的自动提案已冻结", Teach{
			Summary:   "进化已冻结",
			NextSteps: []string{"在设置里解冻，或 discard(freeze=false) 后人工 propose"},
		})
	}

	baseLessons := ""
	if d.Notebook != nil {
		if note, err := d.Notebook.GetNote(notebook.SkillNoteID(skillPath)); err == nil && note != nil {
			baseLessons = notebook.ExtractWorkflowNoteBodyExtras(note.Content).Lessons
		}
	}

	summary := "浏览器宏进化候选"
	if intent := strings.TrimSpace(in.Intent); intent != "" {
		summary = truncateRunes(intent, 48)
	} else if ep.Intent != "" {
		summary = truncateRunes(ep.Intent, 48)
	}

	c := d.Harness.Add(HarnessCandidate{
		EpisodeID:    ep.ID,
		ProjectID:    projectID,
		SkillPath:    skillPath,
		Domain:       domain,
		Status:       harnessStatusProposed,
		LessonsPatch: patch,
		Summary:      summary,
		BaseLessons:  baseLessons,
	})
	// 自动静态评测一轮，方便进化卡直接展示分数
	_ = EvalHarnessCandidate(d, c.ID)
	c, _ = d.Harness.Get(c.ID)

	if in.EmitUI {
		emitHarnessEvolve(d, c)
	}
	return OKData(map[string]interface{}{
		"ok":        true,
		"candidate": c,
		"teach": Teach{
			Summary: "已生成 harness 候选（shadow）",
			NextSteps: []string{
				"eval_harness_candidate 看分（已自动评过可跳过）",
				"人确认后 promote_harness_candidate；不对再 discard",
			},
		},
		"note": "候选不进 learningDigest，直到 promote",
	})
}

func looksLikeHarnessablePatch(domain, patch string) bool {
	low := strings.ToLower(patch)
	if domain != "" && domain != "browser" {
		// 首期只落地 browser；其它域显式拒绝
		return false
	}
	// 避免单字「宏」误伤；要求明确浏览器/宏路径信号。
	keys := []string{
		"browser_run", "网页宏", "browser_", "macro",
		"mode=macro", "browser_fill", "browser_navigate", "browser_snapshot",
		"browser_click", "locator", "ref=",
	}
	for _, k := range keys {
		if strings.Contains(low, strings.ToLower(k)) {
			return true
		}
	}
	return false
}

func frozenSkill(d *Deps, skillPath string) bool {
	if d == nil || d.Harness == nil {
		return false
	}
	d.Harness.mu.RLock()
	defer d.Harness.mu.RUnlock()
	for _, it := range d.Harness.items {
		if it.SkillPath == skillPath && it.Status == harnessStatusFrozen {
			return true
		}
	}
	return false
}

// EvalHarnessCandidate 静态打分。
func EvalHarnessCandidate(d *Deps, candidateID string) ToolResult {
	if d == nil || d.Harness == nil {
		return Fail("harness 账本未就绪")
	}
	c, ok := d.Harness.Get(candidateID)
	if !ok {
		return Fail("候选不存在")
	}
	score := scoreHarnessCandidate(c)
	c.Score = &score
	c.Status = harnessStatusEvaluated
	_ = d.Harness.Update(c)
	return OKData(map[string]interface{}{
		"ok":        true,
		"candidate": c,
		"score":     score,
		"teach": Teach{
			Summary: "静态评测完成 · " + itoa(score.Total) + " 分",
			NextSteps: []string{
				func() string {
					if score.Pass {
						return "分数达标：promote_harness_candidate 升版"
					}
					return "未达标：改补丁再 propose，或 force 升版（不推荐）"
				}(),
			},
		},
	})
}

func scoreHarnessCandidate(c HarnessCandidate) HarnessEvalScore {
	total := 0
	var br []string
	patch := strings.TrimSpace(c.LessonsPatch)
	base := strings.TrimSpace(c.BaseLessons)

	if patch == "" {
		return HarnessEvalScore{Total: 0, Breakdown: []string{"空补丁"}, Pass: false, EvaluatedAt: time.Now().UnixMilli()}
	}
	// 宏信号
	if strings.Contains(strings.ToLower(patch), "browser_run") || strings.Contains(patch, "网页宏") {
		total += 30
		br = append(br, "+30 含 browser_run/宏")
	} else if looksLikeHarnessablePatch("browser", patch) {
		total += 18
		br = append(br, "+18 含浏览器路径信号")
	}
	// 新颖度
	if base == "" || strings.Contains(base, "尚无沉淀") {
		total += 20
		br = append(br, "+20 基线为空，补丁即首版经验")
	} else if !strings.Contains(base, patch) {
		total += 25
		br = append(br, "+25 相对基线有新内容")
	} else {
		total += 5
		br = append(br, "+5 与基线高度重复")
	}
	// 体量
	n := len([]rune(patch))
	switch {
	case n >= 40 && n <= 1200:
		total += 20
		br = append(br, "+20 体量适中")
	case n < 40:
		total += 8
		br = append(br, "+8 补丁偏短")
	default:
		total += 10
		br = append(br, "+10 补丁偏长，升版后注意精炼")
	}
	// 可操作下一步
	if strings.Contains(patch, "update_skill") || strings.Contains(patch, "offer_") ||
		strings.Contains(patch, "下次") || strings.Contains(patch, "收口") {
		total += 15
		br = append(br, "+15 含可复用/收口指引")
	} else {
		total += 5
		br = append(br, "+5 缺明确复用指引")
	}
	if total > 100 {
		total = 100
	}
	return HarnessEvalScore{
		Total: total, Breakdown: br, Pass: total >= harnessPromoteMinScore,
		EvaluatedAt: time.Now().UnixMilli(),
	}
}

// PromoteHarnessCandidate pin + update_skill。
func PromoteHarnessCandidate(d *Deps, candidateID, intent string, force bool) ToolResult {
	if d == nil || d.Harness == nil {
		return Fail("harness 账本未就绪")
	}
	c, ok := d.Harness.Get(candidateID)
	if !ok {
		return Fail("候选不存在")
	}
	if c.Status == harnessStatusPromoted {
		return OKData(map[string]interface{}{"ok": true, "already": true, "candidate": c})
	}
	if c.Status == harnessStatusDiscarded || c.Status == harnessStatusFrozen {
		return Fail("候选已丢弃/冻结")
	}
	if intent == "" {
		intent = "harness 升版 · " + c.Summary
	}
	if c.Score == nil {
		_ = EvalHarnessCandidate(d, c.ID)
		c, _ = d.Harness.Get(c.ID)
	}
	if c.Score != nil && !c.Score.Pass && !force {
		return FailTeach("分数未达标，拒绝升版", Teach{
			Summary: "评测未通过（需 ≥" + itoa(harnessPromoteMinScore) + "）",
			NextSteps: []string{
				"看 score.breakdown 改进补丁",
				"确有必要再 promote(force=true)",
			},
			Raw: itoa(c.Score.Total),
		})
	}

	res := UpdateSkillNow(d, UpdateSkillArgs{
		Name:    c.SkillPath,
		Intent:  intent,
		Lessons: c.LessonsPatch,
	})
	if !res.OK {
		return FailTeach("升版写入失败："+res.Error, Teach{
			Summary:   "update_skill 失败，候选仍为 shadow",
			NextSteps: []string{"检查 skillPath 是否存在", "失败不会破坏旧版（未成功写入）"},
			Raw:       res.Error,
		})
	}
	// 内容可能已在回合收口写入（dedupe 跳过）；仍打 pin 作为 harness 升版检查点。
	skipped := false
	if len(res.Data) > 0 {
		var meta map[string]interface{}
		if json.Unmarshal(res.Data, &meta) == nil {
			if v, ok := meta["skipped"].(bool); ok && v {
				skipped = true
			}
		}
	}
	if skipped && d.Notebook != nil {
		_, _ = d.Notebook.PinSkillVersion(c.SkillPath, "harness 升版检查点: "+truncateRunes(intent, 40))
	}
	c.Status = harnessStatusPromoted
	c.PromotedAt = time.Now().UnixMilli()
	_ = d.Harness.Update(c)
	if d.MCPConfirm != nil {
		d.MCPConfirm.EmitStage("harness", "已升版 · "+c.SkillPath, intent, c.SkillPath, workbench.CapPromoteHarnessCandidate)
	}
	return OKData(map[string]interface{}{
		"ok":        true,
		"candidate": c,
		"skillPath": c.SkillPath,
		"skipped":   skipped,
		"teach": Teach{
			Summary:   "Harness 已升版",
			NextSteps: []string{"下次 open_project_stage 读 learningDigest 应看到新经验", "写错用 Skill 版本 restore"},
		},
	})
}

// DiscardHarnessCandidate 丢弃或冻结。
func DiscardHarnessCandidate(d *Deps, candidateID string, freeze bool) ToolResult {
	if d == nil || d.Harness == nil {
		return Fail("harness 账本未就绪")
	}
	c, ok := d.Harness.Get(candidateID)
	if !ok {
		return Fail("候选不存在")
	}
	if freeze {
		c.Status = harnessStatusFrozen
	} else {
		c.Status = harnessStatusDiscarded
	}
	_ = d.Harness.Update(c)
	return OKData(map[string]interface{}{"ok": true, "candidate": c})
}

// MaybeProposeHarnessAfterEpisode 回合写盘成功后自动提案（仅 browser 域）。
func MaybeProposeHarnessAfterEpisode(d *Deps, episodeID, skillPath string, writtenLessons []string) *HarnessCandidate {
	if d == nil || d.Harness == nil || len(writtenLessons) == 0 {
		return nil
	}
	patch := strings.Join(writtenLessons, "\n\n")
	if !looksLikeHarnessablePatch("browser", patch) {
		return nil
	}
	res := ProposeHarnessPatch(d, ProposeHarnessArgs{
		EpisodeID:    episodeID,
		SkillPath:    skillPath,
		LessonsPatch: patch,
		Domain:       "browser",
		EmitUI:       true,
	})
	if !res.OK {
		return nil
	}
	var wrap struct {
		Candidate *HarnessCandidate `json:"candidate"`
	}
	_ = json.Unmarshal(res.Data, &wrap)
	return wrap.Candidate
}

func emitHarnessEvolve(d *Deps, c HarnessCandidate) {
	if d == nil || d.MCPConfirm == nil || d.MCPConfirm.emit == nil {
		return
	}
	scoreTotal := 0
	pass := false
	var breakdown []string
	if c.Score != nil {
		scoreTotal = c.Score.Total
		pass = c.Score.Pass
		breakdown = c.Score.Breakdown
	}
	payload := map[string]interface{}{
		"candidateId":  c.ID,
		"episodeId":    c.EpisodeID,
		"projectId":    c.ProjectID,
		"skillPath":    c.SkillPath,
		"domain":       c.Domain,
		"status":       c.Status,
		"summary":      c.Summary,
		"lessonsPatch": truncateRunes(c.LessonsPatch, 800),
		"scoreTotal":   scoreTotal,
		"scorePass":    pass,
		"breakdown":    breakdown,
		"minScore":     harnessPromoteMinScore,
		"title":        "Skill 可升版（harness 进化）",
		"benefit":      "采纳后下次同类网页宏少摸索",
		"offerPrompt":  "评测通过则可升版；升版会 pin 旧版，写错可 restore。",
		"at":           time.Now().UnixMilli(),
	}
	d.MCPConfirm.emit("mcp:harness_evolve", payload)
	d.MCPConfirm.EmitStage("harness", "进化候选 · "+itoa(scoreTotal)+" 分", c.Summary, c.SkillPath, "harness_evolve")
}

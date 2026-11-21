package workbenchtools

import (
	"strings"

	"WWorkbench/internal/model"
	"WWorkbench/internal/notebook"
	"WWorkbench/internal/store"
)

const (
	learningDigestLessonLimit  = 5
	learningDigestTrustLimit   = 5
	learningDigestEpisodeLimit = 3
)

// BuildLearningDigest 组装项目前馈摘要（Skill 经验 + 已信任操作 + 未收口回合）。
func BuildLearningDigest(d *Deps, projectID string) *model.LearningDigestDO {
	if d == nil {
		return nil
	}
	projectID = strings.TrimSpace(projectID)
	var p model.WorkbenchProjectDO
	if projectID != "" && d.Store != nil {
		if got, err := d.Store.GetWorkbenchProject(projectID); err == nil {
			p = got
		}
	}
	if strings.TrimSpace(p.ID) == "" && d.Store != nil {
		id, _ := d.Store.GetAppSetting(store.SettingLastWorkbenchProjectID)
		id = strings.TrimSpace(id)
		if id != "" {
			if got, err := d.Store.GetWorkbenchProject(id); err == nil {
				p = got
			}
		}
	}
	if strings.TrimSpace(p.ID) == "" {
		return nil
	}

	skillPath := projectSkillPath(p)
	out := &model.LearningDigestDO{
		ProjectID:   p.ID,
		ProjectName: strings.TrimSpace(p.Name),
		SkillPath:   skillPath,
		Lessons:     []string{},
		TrustedOps:  []string{},
		OpenEpisodes: []model.LearningEpisodeBriefDO{},
	}

	if d.Notebook != nil && skillPath != "" {
		if note, err := d.Notebook.GetNote(notebook.SkillNoteID(skillPath)); err == nil && note != nil {
			extras := notebook.ExtractWorkflowNoteBodyExtras(note.Content)
			out.Lessons = clipDigestLines(extras.Lessons, learningDigestLessonLimit)
			out.TrustedOps = clipDigestLines(extras.TrustedOps, learningDigestTrustLimit)
		}
	}

	if d.Episodes != nil {
		for _, ep := range d.Episodes.ListOpen(p.ID, learningDigestEpisodeLimit) {
			out.OpenEpisodes = append(out.OpenEpisodes, model.LearningEpisodeBriefDO{
				ID:            ep.ID,
				Intent:        ep.Intent,
				Status:        ep.Status,
				PendingCount:  len(ep.PendingLessons),
				HumanSummary:  episodeHumanSummary(ep),
			})
		}
	}

	if len(out.Lessons) == 0 && len(out.TrustedOps) == 0 && len(out.OpenEpisodes) == 0 {
		out.Note = "尚无沉淀；跑通后收口写入项目 Skill，下次开场会前馈。"
	} else {
		out.Note = "动手前先读本摘要；已沉淀路径勿空手重探。"
	}
	return out
}

func projectSkillPath(p model.WorkbenchProjectDO) string {
	for _, link := range p.Links {
		if strings.EqualFold(strings.TrimSpace(link.Kind), "skill") {
			sp := strings.TrimSpace(link.ID)
			if sp != "" {
				return strings.TrimSuffix(sp, "/SKILL.md")
			}
		}
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return ""
	}
	return "项目/" + name
}

func clipDigestLines(section string, limit int) []string {
	section = strings.TrimSpace(section)
	if section == "" || strings.Contains(section, "尚无沉淀") {
		return nil
	}
	raw := strings.Split(section, "\n")
	out := make([]string, 0, limit)
	for _, line := range raw {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		line = strings.TrimPrefix(line, "- ")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if len(line) > 160 {
			line = line[:160] + "…"
		}
		out = append(out, line)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func episodeHumanSummary(ep LearningEpisode) string {
	n := len(ep.PendingLessons)
	intent := strings.TrimSpace(ep.Intent)
	if intent == "" {
		intent = "未命名目标"
	}
	if n <= 0 {
		return "回合进行中 · " + truncateRunes(intent, 36)
	}
	return "可沉淀 " + itoa(n) + " 条 · " + truncateRunes(intent, 36)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

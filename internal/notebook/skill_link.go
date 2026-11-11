package notebook

import (
	"regexp"
	"strings"
)

var skillMarkRE = regexp.MustCompile(`<!--\s*wwb-skill:\s*([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\s*-->`)

// ReadLinkedSkillID 从笔记正文读取已关联 skill id。
func ReadLinkedSkillID(content string) string {
	m := skillMarkRE.FindStringSubmatch(content)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// WithLinkedSkillID 写入/更新关联标记（放在 frontmatter 之后，避免破坏 YAML 头）。
func WithLinkedSkillID(content, skillID string) string {
	id := strings.TrimSpace(skillID)
	mark := "<!-- wwb-skill: " + id + " -->"
	if skillMarkRE.MatchString(content) {
		return skillMarkRE.ReplaceAllString(content, mark)
	}
	fm, body, ok := splitFrontmatterMap(content)
	if ok {
		body = mark + "\n\n" + strings.TrimLeft(body, " \t\r\n")
		return joinFrontmatterMap(fm, body)
	}
	trimmed := strings.TrimLeft(content, " \t\r\n")
	return mark + "\n\n" + trimmed
}

// StripSkillMark 发布时去掉标记，避免写进 Skill 正文。
func StripSkillMark(content string) string {
	out := skillMarkRE.ReplaceAllString(content, "")
	return strings.TrimLeft(out, " \t\r\n")
}

// LinkSkillNote 把笔记标成工作流（role=skill + 关联标记 + 工作流目录）。
func (s *Service) LinkSkillNote(skillID, noteID string) error {
	if s == nil {
		return nil
	}
	skillID = strings.TrimSpace(skillID)
	noteID = strings.TrimSpace(noteID)
	if skillID == "" || noteID == "" {
		return nil
	}
	_, err := s.MarkNoteAsSkill(noteID, skillID)
	return err
}

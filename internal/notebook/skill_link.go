package notebook

import (
	"regexp"
	"strings"
	"time"

	"WWorkbench/internal/model"
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

// WithLinkedSkillID 写入/更新关联标记。
func WithLinkedSkillID(content, skillID string) string {
	id := strings.TrimSpace(skillID)
	mark := "<!-- wwb-skill: " + id + " -->"
	if skillMarkRE.MatchString(content) {
		return skillMarkRE.ReplaceAllString(content, mark)
	}
	trimmed := strings.TrimLeft(content, " \t\r\n")
	return mark + "\n\n" + trimmed
}

// StripSkillMark 发布时去掉标记，避免写进 Skill 正文。
func StripSkillMark(content string) string {
	out := skillMarkRE.ReplaceAllString(content, "")
	return strings.TrimLeft(out, " \t\r\n")
}

// LinkSkillNote 发布后在来源笔记写入 skill 关联标记。
func (s *Service) LinkSkillNote(skillID, noteID string) error {
	if s == nil {
		return nil
	}
	skillID = strings.TrimSpace(skillID)
	noteID = strings.TrimSpace(noteID)
	if skillID == "" || noteID == "" {
		return nil
	}
	n, err := s.GetNote(noteID)
	if err != nil {
		return err
	}
	next := WithLinkedSkillID(n.Content, skillID)
	if next == n.Content {
		return nil
	}
	n.Content = next
	n.UpdatedAt = time.Now().Unix()
	_, err = s.SaveNote(*n)
	return err
}

// LegacySkillNotesGroupName 旧版 Skill 镜像分组（已废弃）。
const LegacySkillNotesGroupName = "方法包"

const legacySkillNoteIDPrefix = "skill-note-"

// RemoveLegacySkillNotesGroup 删除「方法包」分组及其 Skill 镜像笔记。
func (s *Service) RemoveLegacySkillNotesGroup() error {
	if s == nil {
		return nil
	}
	groups, err := s.ListGroups()
	if err != nil {
		return err
	}
	var groupID string
	for _, g := range groups {
		if strings.TrimSpace(g.Name) == LegacySkillNotesGroupName {
			groupID = g.ID
			break
		}
	}
	if groupID == "" {
		return nil
	}
	notes, err := s.ListNotes()
	if err != nil {
		return err
	}
	for _, summary := range notes {
		if summary.GroupID != groupID {
			continue
		}
		if !isLegacySkillMirrorNote(summary) {
			continue
		}
		if err := s.DeleteNote(summary.ID); err != nil {
			return err
		}
	}
	return s.DeleteGroup(groupID)
}

func isLegacySkillMirrorNote(n model.NoteSummaryDO) bool {
	if strings.HasPrefix(strings.TrimSpace(n.Title), "方法：") {
		return true
	}
	if strings.HasPrefix(n.ID, legacySkillNoteIDPrefix) {
		return true
	}
	return false
}

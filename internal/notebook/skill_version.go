package notebook

import (
	"fmt"
	"path/filepath"
	"strings"

	"WWorkbench/internal/dirgit"
)

// SkillVersion 技能目录仓的一版提交（兼容旧名）。
type SkillVersion = dirgit.CommitInfo

// SkillVersionStatus 技能目录版本时间轴。
type SkillVersionStatus struct {
	Name    string         `json:"name"`
	NoteID  string         `json:"noteId"`
	Dir     string         `json:"dir"`
	Rel     string         `json:"rel"`
	Head    string         `json:"head,omitempty"`
	Working bool           `json:"working"`
	Enabled bool           `json:"enabled"`
	Commits []SkillVersion `json:"commits"`
}

// SkillDirRel 技能目录相对笔记本根路径（任意业务根；短名默认 工作流/{name}）。
func SkillDirRel(skillName string) (string, error) {
	return skillDirRel(skillName)
}

func skillDirRel(skillName string) (string, error) {
	skillName = strings.TrimSpace(strings.ReplaceAll(skillName, "\\", "/"))
	skillName = strings.Trim(skillName, "/")
	if skillName == "" {
		return "", fmt.Errorf("skill name 不能为空")
	}
	if dir := SkillDirFromNoteID(skillName); dir != "" {
		return dir, nil
	}
	if strings.Contains(skillName, "/") {
		if strings.Contains(skillName, "..") {
			return "", fmt.Errorf("无效 skill name: %s", skillName)
		}
		return skillName, nil
	}
	return SkillGroupName + "/" + skillName, nil
}

// PinSkillVersion 创建技能目录版本（自动启用；排除 log.md）。
func (s *Service) PinSkillVersion(skillName, message string) (SkillVersion, error) {
	rel, err := SkillDirRel(skillName)
	if err != nil {
		return SkillVersion{}, err
	}
	return s.PinDirVersion(rel, message)
}

// ListSkillVersions 列出技能目录版本。
func (s *Service) ListSkillVersions(skillName string, limit int) (SkillVersionStatus, error) {
	rel, err := SkillDirRel(skillName)
	if err != nil {
		return SkillVersionStatus{}, err
	}
	st, err := s.ListDirVersions(rel, limit)
	if err != nil {
		return SkillVersionStatus{}, err
	}
	name := SkillNameFromNoteID(rel + "/" + SkillEntryFile)
	if name == "" {
		name = filepath.Base(rel)
	}
	return SkillVersionStatus{
		Name: name, NoteID: SkillNoteID(rel), Dir: st.Dir, Rel: st.Rel,
		Head: st.Head, Working: st.Working, Enabled: st.Enabled, Commits: st.Commits,
	}, nil
}

// RestoreSkillVersion 回退技能目录。
func (s *Service) RestoreSkillVersion(skillName, hash, message string) (SkillVersion, error) {
	rel, err := SkillDirRel(skillName)
	if err != nil {
		return SkillVersion{}, err
	}
	return s.RestoreDirVersion(rel, hash, message)
}

// ShowSkillVersion 读某版 SKILL.md。
func (s *Service) ShowSkillVersion(skillName, hash string) (string, error) {
	rel, err := SkillDirRel(skillName)
	if err != nil {
		return "", err
	}
	abs, _, err := s.ResolveDirRel(rel)
	if err != nil {
		return "", err
	}
	return dirgit.ShowFile(abs, hash, SkillEntryFile)
}

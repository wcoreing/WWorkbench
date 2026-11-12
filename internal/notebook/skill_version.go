package notebook

import (
	"fmt"
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

// SkillDirRel 工作流/{name} 相对笔记本根路径。
func SkillDirRel(skillName string) (string, error) {
	name, err := skillDirName(skillName)
	if err != nil {
		return "", err
	}
	return SkillGroupName + "/" + name, nil
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
	name := strings.TrimPrefix(rel, SkillGroupName+"/")
	return SkillVersionStatus{
		Name: name, NoteID: SkillNoteID(name), Dir: st.Dir, Rel: st.Rel,
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

func skillDirName(skillName string) (string, error) {
	skillName = strings.TrimSpace(strings.ReplaceAll(skillName, "\\", "/"))
	if skillName == "" {
		return "", fmt.Errorf("skill name 不能为空")
	}
	if n := SkillNameFromNoteID(skillName); n != "" {
		return n, nil
	}
	if strings.HasPrefix(skillName, SkillGroupName+"/") {
		rest := strings.TrimPrefix(skillName, SkillGroupName+"/")
		if i := strings.Index(rest, "/"); i >= 0 {
			rest = rest[:i]
		}
		rest = strings.TrimSpace(rest)
		if rest == "" {
			return "", fmt.Errorf("无效 skill name: %s", skillName)
		}
		return rest, nil
	}
	if strings.Contains(skillName, "/") {
		return "", fmt.Errorf("无效 skill name: %s", skillName)
	}
	return skillName, nil
}

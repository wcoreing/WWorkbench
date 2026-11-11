package notebook

import (
	"path/filepath"
	"strings"

	"WWorkbench/internal/errno"
)

// groupDirAbs 分组目录绝对路径；id = 相对路径，与磁盘目录名一致。
func (s *Service) groupDirAbs(groupID string) (string, error) {
	root := s.workspaceRoot()
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return root, nil
	}
	rel := filepath.FromSlash(groupID)
	if rel == "." || strings.Contains(rel, "..") {
		return "", errno.New(errno.CodeInvalidArg, "非法分组路径", groupID)
	}
	return filepath.Join(root, rel), nil
}

// skillDirAbs 解析 Skill 目录：工作流/{name} 或 工作流/{name}/SKILL.md。
func (s *Service) skillDirAbs(noteID string) (dir, name string, ok bool) {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return "", "", false
	}
	rel := strings.TrimSuffix(filepath.ToSlash(noteID), "/"+SkillEntryFile)
	if !strings.HasPrefix(rel, SkillGroupName+"/") {
		return "", "", false
	}
	rest := strings.TrimPrefix(rel, SkillGroupName+"/")
	if rest == "" || strings.Contains(rest, "/") {
		return "", "", false
	}
	return filepath.Join(s.workspaceRoot(), SkillGroupName, rest), rest, true
}

// notePaths 解析笔记内容路径与附件目录（id = 工作区相对路径）。
func (s *Service) notePaths(noteID string) (contentPath, assetsDir string, err error) {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return "", "", errno.New(errno.CodeInvalidArg, "笔记 ID 不能为空", "")
	}
	if dir, _, ok := s.skillDirAbs(noteID); ok {
		return filepath.Join(dir, SkillEntryFile), filepath.Join(dir, SkillAssetsDir), nil
	}
	rel := filepath.FromSlash(noteID)
	if strings.Contains(rel, "..") {
		return "", "", errno.New(errno.CodeInvalidArg, "非法笔记路径", noteID)
	}
	abs := filepath.Join(s.workspaceRoot(), rel)
	if strings.HasSuffix(strings.ToLower(abs), ".md") {
		if strings.EqualFold(filepath.Base(abs), SkillEntryFile) {
			return abs, filepath.Join(filepath.Dir(abs), SkillAssetsDir), nil
		}
		return abs, strings.TrimSuffix(abs, filepath.Ext(abs)) + PlainAssetsSuffix, nil
	}
	return filepath.Join(abs, SkillEntryFile), filepath.Join(abs, SkillAssetsDir), nil
}

func isSkillPathID(id string) bool {
	id = strings.TrimSpace(filepath.ToSlash(id))
	return strings.HasSuffix(strings.ToLower(id), "/"+strings.ToLower(SkillEntryFile)) &&
		strings.HasPrefix(id, SkillGroupName+"/")
}

func groupIDFromRelDir(dir string) string {
	dir = strings.Trim(filepath.ToSlash(dir), "/")
	if dir == "" || dir == "." {
		return ""
	}
	return dir
}

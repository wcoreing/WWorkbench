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

// skillDirAbs 解析 Skill 目录：任意 …/SKILL.md 或技能目录相对路径 / 短名（默认 工作流/{name}）。
func (s *Service) skillDirAbs(noteID string) (dir, name string, ok bool) {
	noteID = strings.TrimSpace(strings.ReplaceAll(noteID, "\\", "/"))
	if noteID == "" || strings.Contains(noteID, "..") {
		return "", "", false
	}
	relDir := SkillDirFromNoteID(noteID)
	if relDir == "" {
		// 目录路径或短名 → 规范成 note id 再取目录
		if nid := SkillNoteID(noteID); nid != "" {
			relDir = SkillDirFromNoteID(nid)
		}
	}
	if relDir == "" {
		return "", "", false
	}
	name = SkillNameFromNoteID(relDir + "/" + SkillEntryFile)
	if name == "" {
		name = filepath.Base(relDir)
	}
	return filepath.Join(s.workspaceRoot(), filepath.FromSlash(relDir)), name, true
}

// notePaths 解析笔记内容路径与附件目录（id = 工作区相对路径）。
func (s *Service) notePaths(noteID string) (contentPath, assetsDir string, err error) {
	noteID = strings.TrimSpace(noteID)
	if noteID == "" {
		return "", "", errno.New(errno.CodeInvalidArg, "笔记 ID 不能为空", "")
	}
	// Skill 入口或可规范为 Skill 的引用 → 同级 assets/
	if isSkillPathID(noteID) {
		if dir, _, ok := s.skillDirAbs(noteID); ok {
			return filepath.Join(dir, SkillEntryFile), filepath.Join(dir, SkillAssetsDir), nil
		}
	}
	if !strings.Contains(noteID, "/") && !strings.HasSuffix(strings.ToLower(noteID), ".md") {
		if nid := SkillNoteID(noteID); isSkillPathID(nid) {
			if dir, _, ok := s.skillDirAbs(nid); ok {
				return filepath.Join(dir, SkillEntryFile), filepath.Join(dir, SkillAssetsDir), nil
			}
		}
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
	return SkillDirFromNoteID(id) != ""
}

func groupIDFromRelDir(dir string) string {
	dir = strings.Trim(filepath.ToSlash(dir), "/")
	if dir == "" || dir == "." {
		return ""
	}
	return dir
}

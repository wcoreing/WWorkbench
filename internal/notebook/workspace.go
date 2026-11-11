package notebook

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const (
	// WorkspaceDirName 固定笔记本工作区（相对 ~/.wworkbench）。
	WorkspaceDirName = "notebook"
	// SkillEntryFile Skill 目录入口文件名。
	SkillEntryFile = "SKILL.md"
	// SkillAssetsDir Skill 附件子目录。
	SkillAssetsDir = "assets"
	// SkillScriptsDir Skill 脚本子目录。
	SkillScriptsDir = "scripts"
	// MetaFileName 工作区元数据。
	MetaFileName = ".wwb-meta.json"
	// GroupOrderFile 目录内排序。
	GroupOrderFile = ".wwb-order.json"
	// PlainAssetsSuffix 普通笔记附件目录后缀：foo.md → foo.assets/
	PlainAssetsSuffix = ".assets"
)

type workspaceMeta struct {
	Version int   `json:"version"`
	ResetAt int64 `json:"resetAt,omitempty"`
}

// WorkspaceRoot 返回固定笔记本根目录 ~/.wworkbench/notebook。
func WorkspaceRoot(dataDir string) string {
	return filepath.Join(strings.TrimSpace(dataDir), WorkspaceDirName)
}

// EnsureWorkspace 创建工作区根目录；meta 由 EnsureFSNotebook / reset 写入。
func (s *Service) EnsureWorkspace() error {
	if s == nil || s.dataDir == "" {
		return errnoNotebook("数据目录未就绪")
	}
	return os.MkdirAll(s.workspaceRoot(), 0o700)
}

func (s *Service) workspaceRoot() string {
	return WorkspaceRoot(s.dataDir)
}

func (s *Service) readMeta() workspaceMeta {
	raw, err := os.ReadFile(filepath.Join(s.workspaceRoot(), MetaFileName))
	if err != nil {
		return workspaceMeta{Version: 0}
	}
	var m workspaceMeta
	_ = json.Unmarshal(raw, &m)
	return m
}

func (s *Service) writeMeta(m workspaceMeta) error {
	if m.Version == 0 {
		m.Version = WorkspaceSchemaVersion
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.workspaceRoot(), MetaFileName), raw, 0o600)
}

// NoteDiskPath 返回笔记内容文件绝对路径（Skill 为目录内 SKILL.md）。
func (s *Service) NoteDiskPath(noteID string) (string, error) {
	contentPath, _, err := s.notePaths(strings.TrimSpace(noteID))
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(contentPath); err != nil {
		return "", err
	}
	return contentPath, nil
}

// NoteDirPath 返回笔记所在目录（Skill 为 Skill 根目录；普通笔记为 .md 所在目录）。
func (s *Service) NoteDirPath(noteID string) (string, error) {
	if dir, _, ok := s.skillDirAbs(strings.TrimSpace(noteID)); ok {
		if _, err := os.Stat(dir); err != nil {
			return "", err
		}
		return dir, nil
	}
	p, err := s.NoteDiskPath(noteID)
	if err != nil {
		return "", err
	}
	return filepath.Dir(p), nil
}

func errnoNotebook(msg string) error {
	return &notebookErr{msg: msg}
}

type notebookErr struct{ msg string }

func (e *notebookErr) Error() string { return e.msg }

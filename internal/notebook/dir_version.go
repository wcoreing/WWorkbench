package notebook

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/file"
)

// DirVersion 目录仓一版提交。版本工具是文件服务绑定的 git。
type DirVersion = file.Revision

// DirVersionStatus 目录版本时间轴。
type DirVersionStatus struct {
	Rel     string       `json:"rel"`
	Dir     string       `json:"dir"`
	Enabled bool         `json:"enabled"`
	Head    string       `json:"head,omitempty"`
	Working bool         `json:"working"`
	Commits []DirVersion `json:"commits"`
}

func (s *Service) gitTool() *file.Git {
	if s == nil || s.files == nil {
		return nil
	}
	if s.files.Git() == nil {
		s.files.BindGit(s.workspaceRoot())
	}
	return s.files.Git()
}

// ResolveDirRel 解析笔记本内相对目录（禁止 .. / 越界）。
func (s *Service) ResolveDirRel(dirRel string) (abs, rel string, err error) {
	if s == nil || s.dataDir == "" {
		return "", "", errnoNotebook("笔记本未就绪")
	}
	rel = filepath.ToSlash(strings.TrimSpace(dirRel))
	rel = strings.Trim(rel, "/")
	if rel == "" || rel == "." {
		return "", "", fmt.Errorf("目录不能为空")
	}
	if strings.Contains(rel, "..") {
		return "", "", fmt.Errorf("非法路径")
	}
	abs = filepath.Join(s.workspaceRoot(), filepath.FromSlash(rel))
	root := s.workspaceRoot()
	absClean, err := filepath.Abs(abs)
	if err != nil {
		return "", "", err
	}
	rootClean, err := filepath.Abs(root)
	if err != nil {
		return "", "", err
	}
	if absClean != rootClean && !strings.HasPrefix(absClean, rootClean+string(os.PathSeparator)) {
		return "", "", fmt.Errorf("路径越界")
	}
	st, err := os.Stat(absClean)
	if err != nil {
		return "", "", fmt.Errorf("目录不存在: %s", rel)
	}
	if !st.IsDir() {
		return "", "", fmt.Errorf("不是目录: %s", rel)
	}
	return absClean, rel, nil
}

// EnableDirVersion 启用目录版本管理。
func (s *Service) EnableDirVersion(dirRel string) (DirVersionStatus, error) {
	g := s.gitTool()
	if g == nil {
		return DirVersionStatus{}, errnoNotebook("文件服务未绑定 git")
	}
	if err := g.Enable(dirRel); err != nil {
		return DirVersionStatus{}, err
	}
	_, rel, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return DirVersionStatus{}, err
	}
	return s.ListDirVersions(rel, 24)
}

// FileRevision 笔记文件在最近一层目录仓中的提交。
func (s *Service) FileRevision(fileRel string) (file.FileRevision, error) {
	g := s.gitTool()
	if g == nil {
		return file.FileRevision{}, errnoNotebook("文件服务未绑定 git")
	}
	return g.FileRevision(fileRel)
}

// ListDirVersions 列出目录版本。
func (s *Service) ListDirVersions(dirRel string, limit int) (DirVersionStatus, error) {
	g := s.gitTool()
	if g == nil {
		return DirVersionStatus{}, errnoNotebook("文件服务未绑定 git")
	}
	st, err := g.Status(dirRel, limit)
	if err != nil {
		return DirVersionStatus{}, err
	}
	return DirVersionStatus{
		Rel: st.Rel, Dir: st.Dir, Enabled: st.Enabled,
		Head: st.Head, Working: st.Working, Commits: st.Commits,
	}, nil
}

// PinDirVersion 创建目录版本。
func (s *Service) PinDirVersion(dirRel, message string) (DirVersion, error) {
	g := s.gitTool()
	if g == nil {
		return DirVersion{}, errnoNotebook("文件服务未绑定 git")
	}
	return g.Pin(dirRel, message)
}

// RestoreDirVersion 回退目录到某版本。
func (s *Service) RestoreDirVersion(dirRel, hash, message string) (DirVersion, error) {
	g := s.gitTool()
	if g == nil {
		return DirVersion{}, errnoNotebook("文件服务未绑定 git")
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		short := strings.TrimSpace(hash)
		if len(short) > 7 {
			short = short[:7]
		}
		msg = "restore: " + short
	}
	return g.Restore(dirRel, hash, msg)
}

// DirVersionEnabled 目录是否已建仓。
func (s *Service) DirVersionEnabled(dirRel string) bool {
	g := s.gitTool()
	if g == nil {
		return false
	}
	return g.Enabled(dirRel)
}

// MapDirVersionFlags 批量：相对路径 → 是否已建仓（只查 .git，不跑 git log）。
func (s *Service) MapDirVersionFlags(dirRels []string) map[string]bool {
	out := make(map[string]bool, len(dirRels))
	for _, raw := range dirRels {
		rel := filepath.ToSlash(strings.TrimSpace(raw))
		rel = strings.Trim(rel, "/")
		if rel == "" {
			continue
		}
		out[rel] = s.DirVersionEnabled(rel)
	}
	return out
}

package notebook

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/dirgit"
)

// DirVersion 目录仓一版提交。
type DirVersion = dirgit.CommitInfo

// DirVersionStatus 目录版本时间轴。
type DirVersionStatus struct {
	Rel     string       `json:"rel"`
	Dir     string       `json:"dir"`
	Enabled bool         `json:"enabled"`
	Head    string       `json:"head,omitempty"`
	Working bool         `json:"working"`
	Commits []DirVersion `json:"commits"`
}

func (s *Service) dirVersionOpt(dirRel string) dirgit.Options {
	return dirgit.Options{ExtraIgnore: dirgit.DefaultExtraIgnore(dirRel)}
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
	abs, rel, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return DirVersionStatus{}, err
	}
	if err := dirgit.Enable(abs, s.dirVersionOpt(rel)); err != nil {
		return DirVersionStatus{}, err
	}
	return s.ListDirVersions(rel, 24)
}

// ListDirVersions 列出目录版本。
func (s *Service) ListDirVersions(dirRel string, limit int) (DirVersionStatus, error) {
	abs, rel, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return DirVersionStatus{}, err
	}
	st, err := dirgit.StatusOf(abs, limit)
	if err != nil {
		return DirVersionStatus{}, err
	}
	return DirVersionStatus{
		Rel: rel, Dir: abs, Enabled: st.Enabled,
		Head: st.Head, Working: st.Working, Commits: st.Commits,
	}, nil
}

// PinDirVersion 创建目录版本。
func (s *Service) PinDirVersion(dirRel, message string) (DirVersion, error) {
	abs, rel, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return DirVersion{}, err
	}
	return dirgit.Pin(abs, message, s.dirVersionOpt(rel))
}

// RestoreDirVersion 回退目录到某版本。
func (s *Service) RestoreDirVersion(dirRel, hash, message string) (DirVersion, error) {
	abs, rel, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return DirVersion{}, err
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		short := strings.TrimSpace(hash)
		if len(short) > 7 {
			short = short[:7]
		}
		msg = "restore: " + short
	}
	return dirgit.Restore(abs, hash, msg, s.dirVersionOpt(rel))
}

// DirVersionEnabled 目录是否已建仓。
func (s *Service) DirVersionEnabled(dirRel string) bool {
	abs, _, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return false
	}
	return dirgit.IsRepo(abs)
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

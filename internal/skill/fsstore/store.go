// Package fsstore 以本机目录树实现 skill.Store（不依赖 notebook.Service）。
// PackageRoot 与笔记本工作区可指向同一磁盘树以兼容现网；货架在 DataDir/skill-shelf。
package fsstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/file"
	"WWorkbench/internal/skill"
)

// Options 构造参数。PreferRoots / DefaultRoot 由产品注入（路径策略不进 skill 核心）。
type Options struct {
	DataDir     string   // 应用数据根（货架 DataDir/skill-shelf）
	PackageRoot string   // 已安装包根目录
	PreferRoots []string // 短名查找优先业务根（如 项目→记忆区→运维→工作流）
	DefaultRoot string   // 短名新建默认根（如 工作流）
}

// Store 文件系统后端。版本经文件服务绑定的 git，不直接执行 git。
type Store struct {
	dataDir     string
	packageRoot string
	preferRoots []string
	defaultRoot string
	files       *file.Service
}

// New 创建存储；根目录不存在时会创建。
func New(opt Options) *Store {
	files := file.New(opt.DataDir)
	files.BindGit(opt.PackageRoot)
	s := &Store{
		dataDir:     strings.TrimSpace(opt.DataDir),
		packageRoot: strings.TrimSpace(opt.PackageRoot),
		preferRoots: append([]string(nil), opt.PreferRoots...),
		defaultRoot: strings.TrimSpace(opt.DefaultRoot),
		files:       files,
	}
	if s.packageRoot != "" {
		_ = os.MkdirAll(s.packageRoot, 0o700)
	}
	if s.dataDir != "" {
		_ = os.MkdirAll(s.shelfRoot(), 0o700)
	}
	return s
}

var _ skill.Store = (*Store)(nil)

func (s *Store) ready() error {
	if s == nil || s.packageRoot == "" {
		return fmt.Errorf("skill 存储未就绪")
	}
	return nil
}

// List 扫描 PackageRoot 下全部 SKILL.md。
func (s *Store) List(prefix string) ([]skill.Package, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	prefix = cleanSlash(prefix)
	s.pruneIdenticalSideCopies()
	entries, err := s.walkEntries()
	if err != nil {
		return nil, err
	}
	out := make([]skill.Package, 0, len(entries))
	for _, e := range entries {
		if prefix != "" && e.dir != prefix && !strings.HasPrefix(e.dir, prefix+"/") {
			continue
		}
		pkg := s.packageFromEntry(e, false)
		out = append(out, pkg)
	}
	return out, nil
}

// Get 按短名 / 目录 / …/SKILL.md 读取。
func (s *Store) Get(ref string) (skill.Package, error) {
	if err := s.ready(); err != nil {
		return skill.Package{}, err
	}
	e, err := s.resolveEntry(ref, false)
	if err != nil {
		return skill.Package{}, err
	}
	return s.packageFromEntry(e, true), nil
}

// Put 写入正文；支持 lessons 追加。短名不存在时落到 DefaultRoot。
func (s *Store) Put(ref string, patch skill.Patch) (skill.Package, error) {
	if err := s.ready(); err != nil {
		return skill.Package{}, err
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return skill.Package{}, fmt.Errorf("skill ref 不能为空")
	}
	e, err := s.resolveEntry(ref, true)
	if err != nil {
		return skill.Package{}, err
	}
	content := strings.TrimSpace(patch.Content)
	if content == "" && len(patch.Lessons) == 0 && patch.Steps == "" && patch.Scripts == "" && patch.Resources == "" {
		return skill.Package{}, fmt.Errorf("Put 需要 content 或 lessons/steps/scripts/resources")
	}
	if content == "" {
		raw, readErr := os.ReadFile(e.absEntry)
		if readErr != nil && !os.IsNotExist(readErr) {
			return skill.Package{}, readErr
		}
		content = string(raw)
	}
	if len(patch.Lessons) > 0 {
		content = appendLessons(content, patch.Lessons)
	}
	if patch.Steps != "" || patch.Scripts != "" || patch.Resources != "" {
		if strings.TrimSpace(patch.Content) == "" {
			return skill.Package{}, fmt.Errorf("结构化 steps/scripts/resources 请由产品侧格式化后经 content 写入")
		}
	}
	if err := os.MkdirAll(e.absDir, 0o700); err != nil {
		return skill.Package{}, err
	}
	_ = os.MkdirAll(filepath.Join(e.absDir, "assets"), 0o700)
	_ = os.MkdirAll(filepath.Join(e.absDir, "scripts"), 0o700)
	if err := os.WriteFile(e.absEntry, []byte(content), 0o600); err != nil {
		return skill.Package{}, err
	}
	e.content = content
	return s.packageFromEntry(e, true), nil
}

// Pin 打目录版本。
func (s *Store) Pin(ref, message string) (skill.Version, error) {
	if err := s.ready(); err != nil {
		return skill.Version{}, err
	}
	e, err := s.resolveEntry(ref, false)
	if err != nil {
		return skill.Version{}, err
	}
	g := s.files.Git()
	if g == nil {
		return skill.Version{}, fmt.Errorf("文件服务未绑定 git")
	}
	info, err := g.Pin(e.dir, message)
	if err != nil {
		return skill.Version{}, err
	}
	return skill.Version{Hash: info.Hash, Message: info.Subject, At: info.When}, nil
}

// ListVersions 版本时间轴。
func (s *Store) ListVersions(ref string, limit int) (skill.VersionStatus, error) {
	if err := s.ready(); err != nil {
		return skill.VersionStatus{}, err
	}
	e, err := s.resolveEntry(ref, false)
	if err != nil {
		return skill.VersionStatus{}, err
	}
	g := s.files.Git()
	if g == nil {
		return skill.VersionStatus{}, fmt.Errorf("文件服务未绑定 git")
	}
	st, err := g.Status(e.dir, limit)
	if err != nil {
		return skill.VersionStatus{}, err
	}
	commits := make([]skill.Version, 0, len(st.Commits))
	for _, c := range st.Commits {
		commits = append(commits, skill.Version{Hash: c.Hash, Message: c.Subject, At: c.When})
	}
	return skill.VersionStatus{
		ID: skill.Basename(e.dir), Dir: e.dir, Head: st.Head,
		Enabled: st.Enabled, Working: st.Working, Commits: commits,
	}, nil
}

// Restore 回退目录版本。
func (s *Store) Restore(ref, hash, message string) (skill.Version, error) {
	if err := s.ready(); err != nil {
		return skill.Version{}, err
	}
	e, err := s.resolveEntry(ref, false)
	if err != nil {
		return skill.Version{}, err
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		short := strings.TrimSpace(hash)
		if len(short) > 7 {
			short = short[:7]
		}
		msg = "restore: " + short
	}
	g := s.files.Git()
	if g == nil {
		return skill.Version{}, fmt.Errorf("文件服务未绑定 git")
	}
	info, err := g.Restore(e.dir, hash, msg)
	if err != nil {
		return skill.Version{}, err
	}
	return skill.Version{Hash: info.Hash, Message: info.Subject, At: info.When}, nil
}

func (s *Store) packageFromEntry(e entry, withContent bool) skill.Package {
	id := publicID(e.dir, s.defaultRoot)
	name := id
	desc, bind, intent := "", "", ""
	hasSteps := false
	body := e.content
	if body == "" {
		if raw, err := os.ReadFile(e.absEntry); err == nil {
			body = string(raw)
		}
	}
	if fm, _, ok := peekFrontmatter(body); ok {
		if n := fmString(fm, "name"); n != "" {
			name = n
			if !strings.Contains(id, "/") {
				id = n
			}
		}
		desc = fmString(fm, "description")
		bind = fmString(fm, "bind")
		intent = fmString(fm, "intent")
		if desc == "" {
			desc = intent
		}
	}
	if strings.Contains(body, "```wwb-skill-steps") {
		hasSteps = true
	}
	pkg := skill.Package{
		Ref: skill.Ref{
			ID:   id,
			Name: firstNonEmpty(name, id),
			Dir:  e.dir,
			Root: skill.FirstRoot(e.dir),
		},
		Description: desc,
		Bind:        bind,
		Intent:      intent,
		DiskPath:    e.absDir,
		AssetsDir:   filepath.Join(e.absDir, "assets"),
		NoteID:      e.relEntry,
		HasSteps:    hasSteps,
	}
	if withContent {
		pkg.Content = body
	}
	return pkg
}

// publicID 工作流短名对外仍用末段；其它根用完整目录。
func publicID(dir, defaultRoot string) string {
	dir = cleanSlash(dir)
	if defaultRoot != "" && strings.HasPrefix(dir, defaultRoot+"/") {
		rest := strings.TrimPrefix(dir, defaultRoot+"/")
		if rest != "" && !strings.Contains(rest, "/") {
			return rest
		}
	}
	return dir
}

package file

import (
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/dirgit"
	"WWorkbench/internal/errno"
)

// Revision 文件服务版本工具的一次提交。
type Revision struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	When    string `json:"when"`
}

// FileRevision 某文件在最近一层目录仓中的提交。未建仓时 Enabled 为 false。
type FileRevision struct {
	Rel     string `json:"rel"`
	Repo    string `json:"repo,omitempty"`
	Enabled bool   `json:"enabled"`
	Short   string `json:"short,omitempty"`
	Dirty   bool   `json:"dirty"`
}

// RevisionStatus 某相对目录的版本时间轴。
type RevisionStatus struct {
	Rel     string     `json:"rel"`
	Dir     string     `json:"dir"`
	Enabled bool       `json:"enabled"`
	Head    string     `json:"head,omitempty"`
	Working bool       `json:"working"`
	Commits []Revision `json:"commits"`
}

// Git 文件服务绑定的版本工具。调用方传工作区相对目录，不直接执行 git。
type Git struct {
	root string
}

func (g *Git) ready() error {
	if g == nil || g.root == "" {
		return errno.New(errno.CodeStoreFailed, "文件服务未绑定 git", "")
	}
	return nil
}

func (g *Git) abs(rel string) (string, string, error) {
	if err := g.ready(); err != nil {
		return "", "", err
	}
	rel = cleanRel(rel)
	if rel == "" {
		return "", "", errno.New(errno.CodeInvalidArg, "目录路径为空", "")
	}
	abs := filepath.Join(g.root, filepath.FromSlash(rel))
	rootClean, err := filepath.Abs(g.root)
	if err != nil {
		return "", "", err
	}
	absClean, err := filepath.Abs(abs)
	if err != nil {
		return "", "", err
	}
	if absClean != rootClean && !strings.HasPrefix(absClean, rootClean+string(os.PathSeparator)) {
		return "", "", errno.New(errno.CodeInvalidArg, "路径越界", rel)
	}
	return absClean, rel, nil
}

func (g *Git) dir(rel string) (string, string, error) {
	abs, clean, err := g.abs(rel)
	if err != nil {
		return "", "", err
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return "", "", errno.New(errno.CodeNotFound, "目录不存在", clean)
	}
	return abs, clean, nil
}

func optFor(rel string) dirgit.Options {
	return dirgit.Options{ExtraIgnore: dirgit.DefaultExtraIgnore(rel)}
}

func fromCommit(c dirgit.CommitInfo) Revision {
	return Revision{Hash: c.Hash, Short: c.Short, Subject: c.Subject, When: c.When}
}

// Enable 为该相对目录建仓。
func (g *Git) Enable(rel string) error {
	abs, clean, err := g.dir(rel)
	if err != nil {
		return err
	}
	return dirgit.Enable(abs, optFor(clean))
}

// Enabled 该目录是否已建仓。
func (g *Git) Enabled(rel string) bool {
	abs, _, err := g.dir(rel)
	if err != nil {
		return false
	}
	return dirgit.IsRepo(abs)
}

// CommitIfDirty 源文件有变更才提交。无变更返回当前版本，changed 为 false。
func (g *Git) CommitIfDirty(rel, message string) (Revision, bool, error) {
	abs, clean, err := g.abs(rel)
	if err != nil {
		return Revision{}, false, err
	}
	info, changed, err := dirgit.CommitIfDirty(abs, message, optFor(clean))
	if err != nil {
		return Revision{}, false, err
	}
	return fromCommit(info), changed, nil
}

// Pin 显式创建一版。无变更时仍保留一条记录。
func (g *Git) Pin(rel, message string) (Revision, error) {
	abs, clean, err := g.dir(rel)
	if err != nil {
		return Revision{}, err
	}
	info, err := dirgit.Pin(abs, message, optFor(clean))
	if err != nil {
		return Revision{}, err
	}
	return fromCommit(info), nil
}

// Status 列出该目录的版本。
func (g *Git) Status(rel string, limit int) (RevisionStatus, error) {
	abs, clean, err := g.dir(rel)
	if err != nil {
		return RevisionStatus{}, err
	}
	st, err := dirgit.StatusOf(abs, limit)
	if err != nil {
		return RevisionStatus{}, err
	}
	commits := make([]Revision, 0, len(st.Commits))
	for _, c := range st.Commits {
		commits = append(commits, fromCommit(c))
	}
	return RevisionStatus{
		Rel: clean, Dir: abs, Enabled: st.Enabled,
		Head: st.Head, Working: st.Working, Commits: commits,
	}, nil
}

// Restore 回退到某版本。
func (g *Git) Restore(rel, hash, message string) (Revision, error) {
	abs, clean, err := g.dir(rel)
	if err != nil {
		return Revision{}, err
	}
	info, err := dirgit.Restore(abs, hash, message, optFor(clean))
	if err != nil {
		return Revision{}, err
	}
	return fromCommit(info), nil
}

// FileRevision 该文件最近一层目录仓里的提交。源未建仓时 Enabled 为 false。
func (g *Git) FileRevision(fileRel string) (FileRevision, error) {
	abs, rel, err := g.abs(fileRel)
	if err != nil {
		return FileRevision{}, err
	}
	root, err := filepath.Abs(g.root)
	if err != nil {
		return FileRevision{}, err
	}
	repo, ok := repoContaining(root, abs)
	out := FileRevision{Rel: rel, Enabled: ok}
	if !ok {
		return out, nil
	}
	repoRel, err := filepath.Rel(root, repo)
	if err != nil {
		return FileRevision{}, err
	}
	out.Repo = filepath.ToSlash(repoRel)
	fileInRepo, err := filepath.Rel(repo, abs)
	if err != nil {
		return FileRevision{}, err
	}
	short, dirty, err := dirgit.FileStamp(repo, filepath.ToSlash(fileInRepo))
	if err != nil {
		return FileRevision{}, err
	}
	out.Short = short
	out.Dirty = dirty
	return out, nil
}

func repoContaining(root, abs string) (string, bool) {
	root = filepath.Clean(root)
	dir := filepath.Clean(abs)
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		dir = filepath.Dir(dir)
	}
	for {
		if dirgit.IsRepo(dir) {
			return dir, true
		}
		if dir == root {
			return "", false
		}
		parent := filepath.Dir(dir)
		if parent == dir || !strings.HasPrefix(dir, root+string(os.PathSeparator)) {
			return "", false
		}
		dir = parent
	}
}

// Show 读取某版本中的相对文件。
func (g *Git) Show(rel, hash, file string) (string, error) {
	abs, _, err := g.dir(rel)
	if err != nil {
		return "", err
	}
	return dirgit.ShowFile(abs, hash, file)
}

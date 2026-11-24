// Package file 工作台文件身份。文档、HTML、图片都是文件；笔记本只是其中一种打开方式。
// 字节仍在原落点。本服务维护 ID、相对路径、资源目录约定，并绑定 git 作为版本工具。
package file

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"WWorkbench/internal/errno"

	"github.com/google/uuid"
)

const (
	ViewMarkdown = "markdown"
	ViewHTML     = "html"
	ViewImage    = "image"
	ViewText     = "text"

	skillEntry  = "SKILL.md"
	skillAssets = "assets"
)

// File 一份已纳入工作台的文件。ID 稳定，RelPath 可随重命名改变。
type File struct {
	ID      string `json:"id"`
	RelPath string `json:"relPath"`
	Name    string `json:"name"`
	View    string `json:"view"`
}

// Place 资源字节的落点。FileID 是资源归属，Dir 是附件绝对目录。
type Place struct {
	FileID     string
	Dir        string
	LinkPrefix string
}

type catalog struct {
	Items []File `json:"items"`
}

// Service 文件目录。账本在 {dataDir}/files/catalog.json。git 是绑定的版本工具。
type Service struct {
	dataDir string
	git     *Git
}

// BindGit 把 git 绑到工作区根。版本仓在各相对目录内的 .git，不另建中心库。
func (s *Service) BindGit(root string) {
	if s == nil {
		return
	}
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || root == "." {
		s.git = nil
		return
	}
	s.git = &Git{root: root}
}

// Git 返回已绑定的版本工具。未绑定时为 nil。
func (s *Service) Git() *Git {
	if s == nil {
		return nil
	}
	return s.git
}

func New(dataDir string) *Service {
	return &Service{dataDir: strings.TrimSpace(dataDir)}
}

var catalogMu sync.Mutex

// Ensure 按工作区相对路径登记文件。已存在则沿用原 ID。
func (s *Service) Ensure(rel string) (File, error) {
	rel = cleanRel(rel)
	if rel == "" {
		return File{}, errno.New(errno.CodeInvalidArg, "文件路径为空", "")
	}
	var out File
	err := s.withCatalog(func(path string, c *catalog) error {
		for _, it := range c.Items {
			if it.RelPath == rel {
				out = it
				return nil
			}
		}
		out = File{
			ID:      uuid.NewString(),
			RelPath: rel,
			Name:    filepath.Base(rel),
			View:    viewFor(rel),
		}
		c.Items = append(c.Items, out)
		return saveCatalog(path, *c)
	})
	return out, err
}

// ByID 按稳定 ID 查找。
func (s *Service) ByID(id string) (File, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return File{}, errno.New(errno.CodeInvalidArg, "文件 ID 为空", "")
	}
	var out File
	var ok bool
	err := s.withCatalog(func(_ string, c *catalog) error {
		for _, it := range c.Items {
			if it.ID == id {
				out = it
				ok = true
				break
			}
		}
		return nil
	})
	if err != nil {
		return File{}, err
	}
	if !ok {
		return File{}, errno.New(errno.CodeNotFound, "文件不在目录中", id)
	}
	return out, nil
}

// Placement 计算该文件的资源落点。Skill 入口用同级 assets/，其余用同名目录里的 assets/。
func Placement(root string, f File) (Place, error) {
	root = strings.TrimSpace(root)
	if root == "" || f.ID == "" || f.RelPath == "" {
		return Place{}, errno.New(errno.CodeInvalidArg, "文件落点无效", f.RelPath)
	}
	abs := filepath.Join(root, filepath.FromSlash(f.RelPath))
	if strings.EqualFold(filepath.Base(f.RelPath), skillEntry) {
		return Place{
			FileID:     f.ID,
			Dir:        filepath.Join(filepath.Dir(abs), skillAssets),
			LinkPrefix: skillAssets,
		}, nil
	}
	stem := strings.TrimSuffix(filepath.Base(f.RelPath), filepath.Ext(f.RelPath))
	if stem == "" {
		stem = "doc"
	}
	bundle := strings.TrimSuffix(abs, filepath.Ext(abs))
	return Place{
		FileID:     f.ID,
		Dir:        filepath.Join(bundle, skillAssets),
		LinkPrefix: stem + "/" + skillAssets,
	}, nil
}

// Rebase 重命名或移动后，改写路径前缀。from/to 为工作区相对路径。
func (s *Service) Rebase(from, to string) error {
	from = cleanRel(from)
	to = cleanRel(to)
	if from == "" || from == to {
		return nil
	}
	return s.withCatalog(func(path string, c *catalog) error {
		changed := false
		for i := range c.Items {
			next, ok := rebasePath(c.Items[i].RelPath, from, to)
			if !ok {
				continue
			}
			c.Items[i].RelPath = next
			c.Items[i].Name = filepath.Base(next)
			changed = true
		}
		if !changed {
			return nil
		}
		return saveCatalog(path, *c)
	})
}

// ForgetTree 删除该路径及其下所有文件登记，返回被删的文件 ID。
func (s *Service) ForgetTree(rel string) ([]string, error) {
	rel = cleanRel(rel)
	if rel == "" {
		return nil, nil
	}
	var ids []string
	err := s.withCatalog(func(path string, c *catalog) error {
		kept := make([]File, 0, len(c.Items))
		for _, it := range c.Items {
			if it.RelPath == rel || strings.HasPrefix(it.RelPath, rel+"/") {
				ids = append(ids, it.ID)
				continue
			}
			kept = append(kept, it)
		}
		if len(ids) == 0 {
			return nil
		}
		c.Items = kept
		return saveCatalog(path, *c)
	})
	return ids, err
}

func (s *Service) catalogPath() (string, error) {
	if strings.TrimSpace(s.dataDir) == "" {
		return "", errno.New(errno.CodeStoreFailed, "数据目录未就绪", "")
	}
	return filepath.Join(s.dataDir, "files", "catalog.json"), nil
}

func (s *Service) withCatalog(fn func(path string, c *catalog) error) error {
	if s == nil {
		return errno.New(errno.CodeStoreFailed, "文件服务未就绪", "")
	}
	path, err := s.catalogPath()
	if err != nil {
		return err
	}
	catalogMu.Lock()
	defer catalogMu.Unlock()
	c, err := loadCatalog(path)
	if err != nil {
		return err
	}
	return fn(path, &c)
}

func loadCatalog(path string) (catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return catalog{}, nil
		}
		return catalog{}, errno.Wrap(errno.CodeStoreFailed, "读取文件目录失败", err)
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return catalog{}, nil
	}
	var c catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return catalog{}, errno.Wrap(errno.CodeStoreFailed, "文件目录损坏", err)
	}
	if c.Items == nil {
		c.Items = []File{}
	}
	return c, nil
}

func saveCatalog(path string, c catalog) error {
	if c.Items == nil {
		c.Items = []File{}
	}
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入文件目录失败", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建文件目录失败", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入文件目录失败", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return errno.Wrap(errno.CodeStoreFailed, "写入文件目录失败", err)
	}
	return nil
}

func cleanRel(rel string) string {
	rel = strings.Trim(filepath.ToSlash(strings.TrimSpace(rel)), "/")
	if rel == "" || rel == "." || strings.Contains(rel, "..") {
		return ""
	}
	return rel
}

func rebasePath(rel, from, to string) (string, bool) {
	if rel == from {
		return to, true
	}
	if strings.HasPrefix(rel, from+"/") {
		return to + rel[len(from):], true
	}
	return rel, false
}

func viewFor(rel string) string {
	ext := strings.ToLower(filepath.Ext(rel))
	switch ext {
	case ".md", ".markdown":
		return ViewMarkdown
	case ".html", ".htm":
		return ViewHTML
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return ViewImage
	default:
		return ViewText
	}
}

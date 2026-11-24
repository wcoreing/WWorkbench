package resource

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"WWorkbench/internal/errno"
)

// catalog 资源账本。字节不在这里，只记归属与文件名。
type catalog struct {
	Items []Item `json:"items"`
}

var catalogMu sync.Mutex

func (s *Service) catalogPath() (string, error) {
	root := strings.TrimSpace(s.dataDir)
	if root == "" {
		return "", errno.New(errno.CodeStoreFailed, "数据目录未就绪", "")
	}
	return filepath.Join(root, "resources", "catalog.json"), nil
}

func loadCatalog(path string) (catalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return catalog{}, nil
		}
		return catalog{}, errno.Wrap(errno.CodeStoreFailed, "读取资源账本失败", err)
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return catalog{}, nil
	}
	var c catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return catalog{}, errno.Wrap(errno.CodeStoreFailed, "资源账本损坏", err)
	}
	if c.Items == nil {
		c.Items = []Item{}
	}
	return c, nil
}

func saveCatalog(path string, c catalog) error {
	if c.Items == nil {
		c.Items = []Item{}
	}
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入资源账本失败", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建资源目录失败", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入资源账本失败", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return errno.Wrap(errno.CodeStoreFailed, "写入资源账本失败", err)
	}
	return nil
}

func (s *Service) withCatalog(fn func(path string, c *catalog) error) error {
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
	if err := fn(path, &c); err != nil {
		return err
	}
	return nil
}

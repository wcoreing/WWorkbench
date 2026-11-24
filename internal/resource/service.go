package resource

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"WWorkbench/internal/errno"

	"github.com/google/uuid"
)

// Service 本地资源服务。同一 dataDir 的多个实例通过账本文件锁互斥。
type Service struct {
	dataDir string
}

// New 创建资源服务。dataDir 为应用数据根（与 notebook 工作区的父目录相同）。
func New(dataDir string) *Service {
	return &Service{dataDir: strings.TrimSpace(dataDir)}
}

// Put 把字节写入 slot 并登记账本。
func (s *Service) Put(slot Slot, name, mimeHint string, raw []byte) (Item, error) {
	if err := slot.validate(); err != nil {
		return Item{}, err
	}
	if len(raw) == 0 {
		return Item{}, errno.New(errno.CodeInvalidArg, "文件内容为空", "")
	}
	display := sanitizeFileName(name)
	if display == "" {
		display = "file"
	}
	mimeType := sniffMIME(display, mimeHint, raw)
	limit := maxAttachmentBytes
	if IsImageMIME(mimeType) {
		limit = maxImageBytes
	}
	if len(raw) > limit {
		return Item{}, errno.New(errno.CodeInvalidArg, fmt.Sprintf("文件超过 %dMB 上限", limit>>20), display)
	}
	ext := extensionFor(display, mimeType, raw)
	if filepath.Ext(display) == "" && ext != "" {
		display += ext
	}
	id := uuid.NewString()
	stored := id + ext
	item := Item{
		ID:         id,
		OwnerID:    slot.OwnerID,
		Name:       display,
		File:       stored,
		MIME:       mimeType,
		Size:       int64(len(raw)),
		LinkPrefix: slot.LinkPrefix,
		CreatedAt:  time.Now().UnixMilli(),
	}
	if err := s.writeFile(slot, stored, raw); err != nil {
		return Item{}, err
	}
	if err := s.upsert(item); err != nil {
		_ = os.Remove(filepath.Join(slot.Dir, stored))
		return Item{}, err
	}
	return item, nil
}

// Import 把本机绝对路径复制进 slot。目录会跳过；全部失败时返回第一个错误。
func (s *Service) Import(slot Slot, paths []string) ([]Item, error) {
	if err := slot.validate(); err != nil {
		return nil, err
	}
	var out []Item
	var first error
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		item, err := s.importOne(slot, p)
		if err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		out = append(out, item)
	}
	if len(out) == 0 && first != nil {
		return nil, first
	}
	if out == nil {
		out = []Item{}
	}
	return out, nil
}

func (s *Service) importOne(slot Slot, src string) (Item, error) {
	src = filepath.Clean(src)
	if !filepath.IsAbs(src) {
		return Item{}, errno.New(errno.CodeInvalidArg, "需要本机绝对路径", src)
	}
	info, err := os.Stat(src)
	if err != nil {
		return Item{}, errno.Wrap(errno.CodeNotFound, "读取文件失败", err)
	}
	if info.IsDir() {
		return Item{}, errno.New(errno.CodeInvalidArg, "不能把目录当作附件", src)
	}
	raw, err := os.ReadFile(src)
	if err != nil {
		return Item{}, errno.Wrap(errno.CodeStoreFailed, "读取文件失败", err)
	}
	return s.Put(slot, filepath.Base(src), "", raw)
}

// List 返回该归属下仍存在的资源，并把附件目录里尚未入账的文件补进账本。
func (s *Service) List(slot Slot) ([]Item, error) {
	if err := slot.validate(); err != nil {
		return nil, err
	}
	var out []Item
	err := s.withCatalog(func(path string, c *catalog) error {
		byFile := map[string]int{}
		for i, it := range c.Items {
			if it.File != "" {
				byFile[it.File] = i
			}
		}
		entries, err := os.ReadDir(slot.Dir)
		if err != nil && !os.IsNotExist(err) {
			return errno.Wrap(errno.CodeStoreFailed, "读取附件目录失败", err)
		}
		seen := map[string]bool{}
		changed := false
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if name == "" || strings.HasPrefix(name, ".") {
				continue
			}
			seen[name] = true
			if idx, ok := byFile[name]; ok && idx < len(c.Items) {
				it := c.Items[idx]
				if it.OwnerID != slot.OwnerID || it.LinkPrefix != slot.LinkPrefix {
					it.OwnerID = slot.OwnerID
					it.LinkPrefix = slot.LinkPrefix
					c.Items[idx] = it
					changed = true
				}
				out = append(out, it)
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			it := itemFromLegacy(slot, name, info.Size(), sniffFile(filepath.Join(slot.Dir, name), name))
			for _, existing := range c.Items {
				if existing.ID == it.ID {
					it.ID = uuid.NewString()
					break
				}
			}
			c.Items = append(c.Items, it)
			byFile[name] = len(c.Items) - 1
			out = append(out, it)
			changed = true
		}
		kept := make([]Item, 0, len(c.Items))
		for _, it := range c.Items {
			if it.OwnerID == slot.OwnerID && it.File != "" && !seen[it.File] {
				changed = true
				continue
			}
			kept = append(kept, it)
		}
		c.Items = kept
		if changed {
			return saveCatalog(path, *c)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []Item{}
	}
	return out, nil
}

// AbsPath 返回资源文件绝对路径。locate 用于按归属找回附件目录。
func (s *Service) AbsPath(id string, locate func(ownerID string) (Slot, error)) (string, error) {
	it, err := s.get(id)
	if err != nil {
		return "", err
	}
	slot, err := locate(it.OwnerID)
	if err != nil {
		return "", err
	}
	full := filepath.Join(slot.Dir, it.File)
	if !withinDir(slot.Dir, full) {
		return "", errno.New(errno.CodeInvalidArg, "资源路径无效", it.File)
	}
	if _, err := os.Stat(full); err != nil {
		return "", errno.Wrap(errno.CodeNotFound, "资源文件不存在", err)
	}
	return full, nil
}

// Delete 删除账本记录与字节。文件已不在时仍清账本。
func (s *Service) Delete(id string, locate func(ownerID string) (Slot, error)) error {
	it, err := s.get(id)
	if err != nil {
		return err
	}
	if locate != nil {
		if slot, locErr := locate(it.OwnerID); locErr == nil {
			full := filepath.Join(slot.Dir, it.File)
			if withinDir(slot.Dir, full) {
				_ = os.Remove(full)
			}
		}
	}
	return s.removeID(it.ID)
}

// ForgetOwner 笔记删除时丢掉该归属的账本行（字节由调用方删目录）。
func (s *Service) ForgetOwner(ownerID string) error {
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return nil
	}
	return s.withCatalog(func(path string, c *catalog) error {
		kept := make([]Item, 0, len(c.Items))
		changed := false
		for _, it := range c.Items {
			if it.OwnerID == ownerID {
				changed = true
				continue
			}
			kept = append(kept, it)
		}
		if !changed {
			return nil
		}
		c.Items = kept
		return saveCatalog(path, *c)
	})
}

func (s *Service) get(id string) (Item, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Item{}, errno.New(errno.CodeInvalidArg, "资源 ID 不能为空", "")
	}
	var found Item
	var ok bool
	err := s.withCatalog(func(_ string, c *catalog) error {
		for _, it := range c.Items {
			if it.ID == id {
				found = it
				ok = true
				break
			}
		}
		return nil
	})
	if err != nil {
		return Item{}, err
	}
	if !ok {
		return Item{}, errno.New(errno.CodeNotFound, "资源不存在", id)
	}
	return found, nil
}

func (s *Service) upsert(item Item) error {
	return s.withCatalog(func(path string, c *catalog) error {
		replaced := false
		for i := range c.Items {
			if c.Items[i].ID == item.ID {
				c.Items[i] = item
				replaced = true
				break
			}
		}
		if !replaced {
			c.Items = append(c.Items, item)
		}
		return saveCatalog(path, *c)
	})
}

func (s *Service) removeID(id string) error {
	return s.withCatalog(func(path string, c *catalog) error {
		kept := make([]Item, 0, len(c.Items))
		for _, it := range c.Items {
			if it.ID == id {
				continue
			}
			kept = append(kept, it)
		}
		c.Items = kept
		return saveCatalog(path, *c)
	})
}

func (s *Service) writeFile(slot Slot, stored string, raw []byte) error {
	if err := os.MkdirAll(slot.Dir, 0o700); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "创建附件目录失败", err)
	}
	full := filepath.Join(slot.Dir, stored)
	if !withinDir(slot.Dir, full) {
		return errno.New(errno.CodeInvalidArg, "资源路径无效", stored)
	}
	if err := os.WriteFile(full, raw, 0o600); err != nil {
		return errno.Wrap(errno.CodeStoreFailed, "写入附件失败", err)
	}
	return nil
}

func itemFromLegacy(slot Slot, name string, size int64, mimeType string) Item {
	if mimeType == "" {
		mimeType = sniffMIME(name, "", nil)
	}
	id := strings.TrimSuffix(name, filepath.Ext(name))
	if id == "" {
		id = uuid.NewString()
	}
	return Item{
		ID:         id,
		OwnerID:    slot.OwnerID,
		Name:       name,
		File:       name,
		MIME:       mimeType,
		Size:       size,
		LinkPrefix: slot.LinkPrefix,
		CreatedAt:  time.Now().UnixMilli(),
	}
}

func sniffFile(path, name string) string {
	f, err := os.Open(path)
	if err != nil {
		return sniffMIME(name, "", nil)
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := f.Read(buf)
	return sniffMIME(name, "", buf[:n])
}

func withinDir(dir, full string) bool {
	dir = filepath.Clean(dir)
	full = filepath.Clean(full)
	rel, err := filepath.Rel(dir, full)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

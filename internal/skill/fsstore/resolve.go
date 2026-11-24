package fsstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"WWorkbench/internal/skill"
)

type entry struct {
	dir      string // 相对 PackageRoot
	relEntry string // …/SKILL.md
	absDir   string
	absEntry string
	content  string
}

// resolveEntry 解析引用。create=true 时短名落到 DefaultRoot。
func (s *Store) resolveEntry(ref string, create bool) (entry, error) {
	ref = cleanSlash(ref)
	if ref == "" {
		return entry{}, fmt.Errorf("skill ref 不能为空")
	}
	if dir := skill.DirFromEntry(ref); dir != "" {
		return s.entryForDir(dir, create)
	}
	if strings.Contains(ref, "/") {
		return s.entryForDir(ref, create)
	}
	// 短名：PreferRoots 已有优先
	for _, root := range s.preferRoots {
		root = cleanSlash(root)
		if root == "" {
			continue
		}
		cand := root + "/" + ref
		if e, err := s.entryForDir(cand, false); err == nil {
			return e, nil
		}
	}
	// 全树 basename / frontmatter name
	if hit := s.findByShortName(ref); hit != "" {
		return s.entryForDir(hit, false)
	}
	if !create {
		return entry{}, fmt.Errorf("未找到 skill：%s", ref)
	}
	root := s.defaultRoot
	if root == "" {
		return entry{}, fmt.Errorf("未配置 DefaultRoot，无法新建短名 skill")
	}
	return s.entryForDir(root+"/"+ref, true)
}

func (s *Store) entryForDir(dir string, create bool) (entry, error) {
	dir = cleanSlash(dir)
	if dir == "" || strings.Contains(dir, "..") {
		return entry{}, fmt.Errorf("非法路径")
	}
	absDir := filepath.Join(s.packageRoot, filepath.FromSlash(dir))
	if err := assertUnderRoot(s.packageRoot, absDir); err != nil {
		return entry{}, err
	}
	relEntry := skill.EntryInDir(dir)
	absEntry := filepath.Join(absDir, skill.EntryFile)
	st, err := os.Stat(absEntry)
	if err != nil {
		if create && os.IsNotExist(err) {
			return entry{dir: dir, relEntry: relEntry, absDir: absDir, absEntry: absEntry}, nil
		}
		return entry{}, fmt.Errorf("未找到 skill：%s", dir)
	}
	if st.IsDir() {
		return entry{}, fmt.Errorf("非法入口: %s", relEntry)
	}
	return entry{dir: dir, relEntry: relEntry, absDir: absDir, absEntry: absEntry}, nil
}

func (s *Store) findByShortName(name string) string {
	entries, err := s.walkEntries()
	if err != nil {
		return ""
	}
	var basenameHits []string
	for _, e := range entries {
		if skill.Basename(e.dir) == name {
			basenameHits = append(basenameHits, e.dir)
		}
		raw, err := os.ReadFile(e.absEntry)
		if err != nil {
			continue
		}
		if fm, _, ok := peekFrontmatter(string(raw)); ok && fmString(fm, "name") == name {
			return e.dir
		}
	}
	for _, root := range s.preferRoots {
		root = cleanSlash(root)
		prefix := root + "/"
		for _, hit := range basenameHits {
			if strings.HasPrefix(hit, prefix) {
				return hit
			}
		}
	}
	if len(basenameHits) > 0 {
		return basenameHits[0]
	}
	return ""
}

func (s *Store) walkEntries() ([]entry, error) {
	root := s.packageRoot
	var out []entry
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "node_modules" || name == "__pycache__" || name == "assets" || name == "scripts" {
				return filepath.SkipDir
			}
			if strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(d.Name(), skill.EntryFile) {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		dir := skill.DirFromEntry(rel)
		if dir == "" {
			return nil
		}
		absDir := filepath.Dir(path)
		if isShelfSideCopy(absDir, dir) {
			return nil
		}
		out = append(out, entry{dir: dir, relEntry: rel, absDir: absDir, absEntry: path})
		return nil
	})
	return out, err
}

func assertUnderRoot(root, abs string) error {
	rootClean, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	absClean, err := filepath.Abs(abs)
	if err != nil {
		return err
	}
	if absClean != rootClean && !strings.HasPrefix(absClean, rootClean+string(os.PathSeparator)) {
		return fmt.Errorf("路径越界")
	}
	return nil
}

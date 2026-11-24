package notebook

import (
	"os"
	"path/filepath"
	"strings"
)

// plainBundleDir 普通笔记的同名资源目录。foo.md → …/foo。Skill 不是这种目录。
func plainBundleDir(contentAbs string) (string, bool) {
	if !strings.HasSuffix(strings.ToLower(contentAbs), ".md") {
		return "", false
	}
	if strings.EqualFold(filepath.Base(contentAbs), SkillEntryFile) {
		return "", false
	}
	return strings.TrimSuffix(contentAbs, filepath.Ext(contentAbs)), true
}

// adoptPlainBundle 笔记换路径时，同名目录跟着走，并改写正文里的功能路径。
func (s *Service) adoptPlainBundle(oldContent, newContent string) {
	oldBundle, ok1 := plainBundleDir(oldContent)
	newBundle, ok2 := plainBundleDir(newContent)
	if !ok1 || !ok2 {
		return
	}
	if !sameFile(oldBundle, newBundle) {
		if st, err := os.Stat(oldBundle); err == nil && st.IsDir() {
			if _, err := os.Stat(newBundle); os.IsNotExist(err) {
				_ = os.Rename(oldBundle, newBundle)
			}
		}
	}
	oldStem := filepath.Base(oldBundle)
	newStem := filepath.Base(newBundle)
	renameBundlePage(newBundle, oldStem, newStem)
	rewriteBundleStem(newContent, oldStem, newStem)
}

// copyPlainBundle 复制笔记时带上同名目录。
func (s *Service) copyPlainBundle(srcContent, dstContent string) {
	srcBundle, ok1 := plainBundleDir(srcContent)
	dstBundle, ok2 := plainBundleDir(dstContent)
	if !ok1 || !ok2 || sameFile(srcBundle, dstBundle) {
		return
	}
	if st, err := os.Stat(srcBundle); err != nil || !st.IsDir() {
		return
	}
	if err := copyDir(srcBundle, dstBundle); err != nil {
		return
	}
	oldStem := filepath.Base(srcBundle)
	newStem := filepath.Base(dstBundle)
	renameBundlePage(dstBundle, oldStem, newStem)
	rewriteBundleStem(dstContent, oldStem, newStem)
}

// removePlainBundle 删除笔记时去掉同名资源目录。
func (s *Service) removePlainBundle(contentAbs string) {
	bundle, ok := plainBundleDir(contentAbs)
	if !ok {
		return
	}
	_ = os.RemoveAll(bundle)
}

func renameBundlePage(bundle, oldStem, newStem string) {
	if bundle == "" || oldStem == "" || oldStem == newStem {
		return
	}
	for _, ext := range []string{".html", ".htm"} {
		src := filepath.Join(bundle, BundleHTMLName, oldStem+ext)
		dst := filepath.Join(bundle, BundleHTMLName, newStem+ext)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		_ = os.Rename(src, dst)
	}
}

func rewriteBundleStem(mdPath, oldStem, newStem string) {
	if oldStem == "" || oldStem == newStem {
		return
	}
	raw, err := os.ReadFile(mdPath)
	if err != nil {
		return
	}
	text := string(raw)
	next := strings.ReplaceAll(text, oldStem+"/assets/", newStem+"/assets/")
	next = strings.ReplaceAll(next, oldStem+"/html/", newStem+"/html/")
	next = strings.ReplaceAll(next, oldStem+".assets/", newStem+"/assets/")
	if next == text {
		return
	}
	_ = os.WriteFile(mdPath, []byte(next), 0o600)
}

// relocateLegacyBundles 把 {stem}.assets 与旁边的 {stem}.html 收进同名目录。只搬这一次旧形状。
func (s *Service) relocateLegacyBundles() error {
	root := s.workspaceRoot()
	var assetDirs []string
	var htmlFiles []string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || path == root {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			if strings.HasSuffix(name, ".assets") {
				assetDirs = append(assetDirs, path)
				return filepath.SkipDir
			}
			return nil
		}
		lower := strings.ToLower(name)
		if strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") {
			htmlFiles = append(htmlFiles, path)
		}
		return nil
	})
	for _, dir := range assetDirs {
		relocateAssetsDir(dir)
	}
	for _, html := range htmlFiles {
		relocateSiblingHTML(html)
	}
	return nil
}

func relocateAssetsDir(dir string) {
	name := filepath.Base(dir)
	stem := strings.TrimSuffix(name, ".assets")
	if stem == "" || stem == name {
		return
	}
	parent := filepath.Dir(dir)
	dest := filepath.Join(parent, stem, BundleAssetsName)
	if _, err := os.Stat(dest); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(dest), 0o700); err == nil {
			if err := os.Rename(dir, dest); err == nil {
				rewriteLegacyAssetLinks(filepath.Join(parent, stem+".md"), stem)
				return
			}
		}
	}
	_ = os.MkdirAll(dest, 0o700)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		_ = os.Rename(filepath.Join(dir, e.Name()), filepath.Join(dest, e.Name()))
	}
	_ = os.Remove(dir)
	rewriteLegacyAssetLinks(filepath.Join(parent, stem+".md"), stem)
}

func relocateSiblingHTML(path string) {
	name := filepath.Base(path)
	if filepath.Base(filepath.Dir(path)) == BundleHTMLName {
		return
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if stem == "" {
		return
	}
	parent := filepath.Dir(path)
	if _, err := os.Stat(filepath.Join(parent, stem+".md")); err != nil {
		return
	}
	dest := filepath.Join(parent, stem, BundleHTMLName, name)
	if _, err := os.Stat(dest); err == nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return
	}
	_ = os.Rename(path, dest)
}

func rewriteLegacyAssetLinks(mdPath, stem string) {
	raw, err := os.ReadFile(mdPath)
	if err != nil {
		return
	}
	text := string(raw)
	next := strings.ReplaceAll(text, stem+".assets/", stem+"/assets/")
	if next == text {
		return
	}
	_ = os.WriteFile(mdPath, []byte(next), 0o600)
}

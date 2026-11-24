package fsstore

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"WWorkbench/internal/skill"
)

const (
	shelfDirName    = "skill-shelf"
	shelfMarkerName = ".wwb-shelf.json"
)

type shelfMarker struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

func (s *Store) shelfRoot() string {
	return filepath.Join(s.dataDir, shelfDirName)
}

func (s *Store) shelfPackageDir(id, version string) string {
	return filepath.Join(s.shelfRoot(), shelfEncodeID(id), version)
}

func shelfEncodeID(id string) string {
	return strings.ReplaceAll(cleanSlash(id), "/", "__")
}

// Export 把已装目录打成货架版本包。
func (s *Store) Export(ref string) (skill.Bundle, error) {
	if err := s.ready(); err != nil {
		return skill.Bundle{}, err
	}
	if s.dataDir == "" {
		return skill.Bundle{}, fmt.Errorf("货架未就绪")
	}
	e, err := s.resolveEntry(ref, false)
	if err != nil {
		return skill.Bundle{}, err
	}
	root := firstPathSegment(e.dir)
	if len(s.preferRoots) > 0 && !isAllowedRoot(root, s.preferRoots) {
		return skill.Bundle{}, fmt.Errorf("只能导出业务根下的技能目录")
	}
	raw, err := os.ReadFile(e.absEntry)
	if err != nil {
		return skill.Bundle{}, fmt.Errorf("目录里没有 %s", skill.EntryFile)
	}
	g := s.files.Git()
	if g == nil {
		return skill.Bundle{}, fmt.Errorf("文件服务未绑定 git")
	}
	info, changed, err := g.CommitIfDirty(e.dir, "skill")
	if err != nil {
		return skill.Bundle{}, err
	}
	version := info.Short
	if version == "" && len(info.Hash) >= 7 {
		version = info.Hash[:7]
	}
	if version == "" {
		return skill.Bundle{}, fmt.Errorf("技能目录没有可用的 git 版本")
	}
	fm, _, _ := peekFrontmatter(string(raw))
	name := firstNonEmpty(fmString(fm, "name"), filepath.Base(e.dir))
	bundle := skill.Bundle{
		ID:          e.dir,
		Name:        name,
		Version:     version,
		Root:        root,
		Bind:        fmString(fm, "bind"),
		Intent:      fmString(fm, "intent"),
		Description: fmString(fm, "description"),
		Limits:      append([]string(nil), skill.DefaultLimits...),
		ExportedAt:  time.Now().Format(time.RFC3339),
	}
	dest := s.shelfPackageDir(e.dir, version)
	var prev skill.Bundle
	if !changed && readJSON(filepath.Join(dest, "manifest.json"), &prev) == nil && prev.Version == version {
		prev.Unchanged = true
		return prev, nil
	}
	if err := os.RemoveAll(dest); err != nil {
		return skill.Bundle{}, err
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return skill.Bundle{}, err
	}
	files, err := copyShelfTree(e.absDir, dest)
	if err != nil {
		return skill.Bundle{}, err
	}
	if !containsPath(files, skill.EntryFile) {
		return skill.Bundle{}, fmt.Errorf("导出后缺少 %s", skill.EntryFile)
	}
	bundle.Files = files
	if err := writeJSON(filepath.Join(dest, "manifest.json"), bundle); err != nil {
		return skill.Bundle{}, err
	}
	return bundle, nil
}

// ReadBundleBodies 读货架版本正文。
func (s *Store) ReadBundleBodies(id, version string) (map[string]string, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if s.dataDir == "" {
		return nil, fmt.Errorf("货架未就绪")
	}
	id = cleanSlash(id)
	version = strings.TrimSpace(version)
	var manifest skill.Bundle
	if err := readJSON(filepath.Join(s.shelfPackageDir(id, version), "manifest.json"), &manifest); err != nil {
		return nil, fmt.Errorf("货架上没有这个版本")
	}
	bodies := map[string]string{}
	for _, rel := range manifest.Files {
		rel = filepath.ToSlash(strings.TrimSpace(rel))
		if !includeShelfFile(rel) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.shelfPackageDir(id, version), filepath.FromSlash(rel)))
		if err != nil {
			return nil, err
		}
		bodies[rel] = string(raw)
	}
	if _, ok := bodies[skill.EntryFile]; !ok {
		return nil, fmt.Errorf("导出后缺少 %s", skill.EntryFile)
	}
	return bodies, nil
}

// Materialize 把外部包写入本机货架。
func (s *Store) Materialize(bundle skill.Bundle) error {
	if err := s.ready(); err != nil {
		return err
	}
	if s.dataDir == "" {
		return fmt.Errorf("货架未就绪")
	}
	id := cleanSlash(bundle.ID)
	version := strings.TrimSpace(bundle.Version)
	if id == "" || version == "" || strings.Contains(id, "..") || strings.Contains(version, "..") || strings.Contains(version, "/") {
		return fmt.Errorf("无效的技能包")
	}
	kept := map[string]string{}
	for rel, body := range bundle.Bodies {
		rel = filepath.ToSlash(strings.TrimSpace(rel))
		if includeShelfFile(rel) {
			kept[rel] = body
		}
	}
	if _, ok := kept[skill.EntryFile]; !ok {
		return fmt.Errorf("技能包缺少 %s", skill.EntryFile)
	}
	names := make([]string, 0, len(kept))
	for name := range kept {
		names = append(names, name)
	}
	sort.Strings(names)
	bundle.ID = id
	bundle.Version = version
	bundle.Files = names
	if len(bundle.Limits) == 0 {
		bundle.Limits = append([]string(nil), skill.DefaultLimits...)
	}
	dest := s.shelfPackageDir(id, version)
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return err
	}
	for _, name := range names {
		target := filepath.Join(dest, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(target, []byte(kept[name]), 0o600); err != nil {
			return err
		}
	}
	return writeJSON(filepath.Join(dest, "manifest.json"), bundle)
}

// ListShelf 列出本机货架。
func (s *Store) ListShelf() ([]skill.ShelfCard, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	if s.dataDir == "" {
		return nil, fmt.Errorf("货架未就绪")
	}
	root := s.shelfRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []skill.ShelfCard{}, nil
		}
		return nil, err
	}
	var cards []skill.ShelfCard
	for _, ent := range entries {
		if !ent.IsDir() || strings.HasPrefix(ent.Name(), ".") {
			continue
		}
		vers, err := os.ReadDir(filepath.Join(root, ent.Name()))
		if err != nil {
			continue
		}
		for _, ver := range vers {
			if !ver.IsDir() {
				continue
			}
			var bundle skill.Bundle
			path := filepath.Join(root, ent.Name(), ver.Name(), "manifest.json")
			if err := readJSON(path, &bundle); err != nil || bundle.ID == "" || bundle.Version == "" {
				continue
			}
			card := skill.ShelfCard{Bundle: bundle, State: "available"}
			if rel, ok := s.installedShelfRel(bundle.ID, bundle.Version); ok {
				card.Installed = true
				card.InstalledRel = rel
				card.State = "installed"
			} else if s.shelfSourceMatches(bundle.ID, bundle.Version) {
				// 上架的就是文档库正本。没有安装标记也已经在库里，不能再显示安装。
				card.Installed = true
				card.InstalledRel = bundle.ID
				card.State = "installed"
			}
			if len(card.Limits) == 0 {
				card.Limits = append([]string(nil), skill.DefaultLimits...)
			}
			cards = append(cards, card)
		}
	}
	sort.Slice(cards, func(i, j int) bool {
		if cards[i].ExportedAt == cards[j].ExportedAt {
			return cards[i].ID < cards[j].ID
		}
		return cards[i].ExportedAt > cards[j].ExportedAt
	})
	if cards == nil {
		cards = []skill.ShelfCard{}
	}
	return cards, nil
}

// Install 把货架版本装进 PackageRoot。
func (s *Store) Install(id, version string) (skill.InstallResult, error) {
	if err := s.ready(); err != nil {
		return skill.InstallResult{}, err
	}
	if s.dataDir == "" {
		return skill.InstallResult{}, fmt.Errorf("货架未就绪")
	}
	id = cleanSlash(id)
	version = strings.TrimSpace(version)
	if id == "" || version == "" || strings.Contains(id, "..") {
		return skill.InstallResult{}, fmt.Errorf("无效的技能包")
	}
	pkg := s.shelfPackageDir(id, version)
	var manifest skill.Bundle
	if err := readJSON(filepath.Join(pkg, "manifest.json"), &manifest); err != nil {
		return skill.InstallResult{}, fmt.Errorf("货架上没有这个版本")
	}
	if manifest.ID != id || manifest.Version != version {
		return skill.InstallResult{}, fmt.Errorf("清单与目录不一致")
	}
	if rel, ok := s.installedShelfRel(id, version); ok {
		return skill.InstallResult{Rel: rel, Version: version, Already: true}, nil
	}
	destRel := id
	side := false
	if s.shelfTargetBusy(id, pkg) {
		destRel = id + "@" + version
		side = true
	}
	destAbs := filepath.Join(s.packageRoot, filepath.FromSlash(destRel))
	if err := os.MkdirAll(destAbs, 0o700); err != nil {
		return skill.InstallResult{}, err
	}
	if err := copyPackageFiles(pkg, destAbs, manifest.Files); err != nil {
		return skill.InstallResult{}, err
	}
	if err := writeJSON(filepath.Join(destAbs, shelfMarkerName), shelfMarker{ID: id, Version: version}); err != nil {
		return skill.InstallResult{}, err
	}
	g := s.files.Git()
	if g == nil {
		return skill.InstallResult{}, fmt.Errorf("文件服务未绑定 git")
	}
	pinned, _, err := g.CommitIfDirty(destRel, "shelf: "+version)
	if err != nil {
		return skill.InstallResult{}, err
	}
	short := pinned.Short
	if short == "" && len(pinned.Hash) >= 7 {
		short = pinned.Hash[:7]
	}
	return skill.InstallResult{
		Rel: destRel, Version: version, SideBySide: side, Pinned: short,
	}, nil
}

// shelfSourceMatches 文档库正本的 SKILL.md 与该货架版本相同。
func (s *Store) shelfSourceMatches(id, version string) bool {
	canon := fileSHA(filepath.Join(s.packageRoot, filepath.FromSlash(id), skill.EntryFile))
	packed := fileSHA(filepath.Join(s.shelfPackageDir(id, version), skill.EntryFile))
	return canon != "" && canon == packed
}

func (s *Store) installedShelfRel(id, version string) (string, bool) {
	pkgHash := fileSHA(filepath.Join(s.shelfPackageDir(id, version), skill.EntryFile))
	for _, rel := range []string{id, id + "@" + version} {
		var marker shelfMarker
		dir := filepath.Join(s.packageRoot, filepath.FromSlash(rel))
		if err := readJSON(filepath.Join(dir, shelfMarkerName), &marker); err != nil {
			continue
		}
		if marker.ID == id && marker.Version == version && fileSHA(filepath.Join(dir, skill.EntryFile)) == pkgHash {
			return rel, true
		}
	}
	return "", false
}

func (s *Store) shelfTargetBusy(id, pkg string) bool {
	abs := filepath.Join(s.packageRoot, filepath.FromSlash(id))
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return false
	}
	entryPath := filepath.Join(abs, skill.EntryFile)
	if _, err := os.Stat(entryPath); err != nil {
		entries, _ := os.ReadDir(abs)
		return len(entries) > 0
	}
	// 正文相同就覆盖安装。git 脏（例如 log.md）不能再复制出「目录@版本」。
	if fileSHA(entryPath) == fileSHA(filepath.Join(pkg, skill.EntryFile)) {
		return false
	}
	return true
}

// isShelfSideCopy 并排安装落点（目录名是 正本@版本），不是可上架的技能正本。
func isShelfSideCopy(absDir, dir string) bool {
	var marker shelfMarker
	if err := readJSON(filepath.Join(absDir, shelfMarkerName), &marker); err != nil {
		return false
	}
	id := cleanSlash(marker.ID)
	return id != "" && id != cleanSlash(dir)
}

// pruneIdenticalSideCopies 删掉与正本正文相同的并排副本。
func (s *Store) pruneIdenticalSideCopies() {
	if s == nil || s.packageRoot == "" {
		return
	}
	var drop []string
	_ = filepath.WalkDir(s.packageRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.EqualFold(d.Name(), skill.EntryFile) {
			return nil
		}
		absDir := filepath.Dir(path)
		rel, relErr := filepath.Rel(s.packageRoot, path)
		if relErr != nil {
			return nil
		}
		dir := skill.DirFromEntry(filepath.ToSlash(rel))
		if dir == "" || !isShelfSideCopy(absDir, dir) {
			return nil
		}
		var marker shelfMarker
		if readJSON(filepath.Join(absDir, shelfMarkerName), &marker) != nil {
			return nil
		}
		canon := filepath.Join(s.packageRoot, filepath.FromSlash(cleanSlash(marker.ID)), skill.EntryFile)
		if fileSHA(canon) == "" || fileSHA(path) != fileSHA(canon) {
			return nil
		}
		drop = append(drop, absDir)
		return nil
	})
	for _, dir := range drop {
		_ = os.RemoveAll(dir)
	}
}

func copyShelfTree(src, dest string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			if skipShelfDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 || !includeShelfFile(rel) {
			return nil
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		if err := copyFile(path, target); err != nil {
			return err
		}
		files = append(files, rel)
		return nil
	})
	sort.Strings(files)
	return files, err
}

func copyPackageFiles(pkg, dest string, files []string) error {
	if len(files) == 0 {
		return fmt.Errorf("技能包是空的")
	}
	for _, rel := range files {
		rel = filepath.ToSlash(strings.TrimSpace(rel))
		if rel == "" || strings.Contains(rel, "..") || !includeShelfFile(rel) {
			return fmt.Errorf("技能包含非法文件: %s", rel)
		}
		src := filepath.Join(pkg, filepath.FromSlash(rel))
		target := filepath.Join(dest, filepath.FromSlash(rel))
		if err := copyFile(src, target); err != nil {
			return err
		}
	}
	return nil
}

func includeShelfFile(rel string) bool {
	rel = filepath.ToSlash(rel)
	base := filepath.Base(rel)
	if base == "" || strings.HasPrefix(base, ".") {
		return false
	}
	lower := strings.ToLower(base)
	if lower == "log.md" || lower == "manifest.json" {
		return false
	}
	switch filepath.Ext(lower) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pyc", ".db", ".sqlite", ".pem", ".key":
		return false
	}
	for _, bad := range []string{"secret", "credential", "token", ".env"} {
		if strings.Contains(lower, bad) {
			return false
		}
	}
	if rel == skill.EntryFile {
		return true
	}
	return strings.HasPrefix(rel, "scripts/") || strings.HasPrefix(rel, "assets/")
}

func skipShelfDir(name string) bool {
	if name == "" || strings.HasPrefix(name, ".") {
		return true
	}
	return name == "__pycache__" || name == "node_modules"
}

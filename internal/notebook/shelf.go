package notebook

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"WWorkbench/internal/dirgit"
)

const (
	// ShelfDirName 本机技能货架（与 notebook 并列，不进笔记本版本仓）。
	ShelfDirName = "skill-shelf"
	// shelfMarkerName 安装落点里的包标记，导出时随点文件一起排除。
	shelfMarkerName = ".wwb-shelf.json"
)

// ShelfLimits 每张货架卡片都带上的边界，避免把安装理解成代操作。
var ShelfLimits = []string{
	"不会替你确认危险动作",
	"桌面步骤不会机械重放",
}

// ShelfManifest 一个可安装的技能版本包。
type ShelfManifest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Root        string   `json:"root"`
	Bind        string   `json:"bind"`
	Intent      string   `json:"intent"`
	Description string   `json:"description"`
	Limits      []string `json:"limits"`
	ExportedAt  string   `json:"exportedAt"`
	Files       []string `json:"files"`
	SharedBy    string   `json:"sharedBy,omitempty"`
	SharedAt    string   `json:"sharedAt,omitempty"`
}

// ShelfCard 货架上的一张卡：可安装，或已经装进笔记本。
type ShelfCard struct {
	ShelfManifest
	Installed    bool   `json:"installed"`
	InstalledRel string `json:"installedRel,omitempty"`
	State        string `json:"state"`
}

// ShelfInstallResult 安装结果。
type ShelfInstallResult struct {
	Rel        string `json:"rel"`
	Version    string `json:"version"`
	SideBySide bool   `json:"sideBySide"`
	Pinned     string `json:"pinned,omitempty"`
	Already    bool   `json:"already"`
}

type shelfMarker struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

// ExportSkillPackage 把笔记本技能目录打成货架版本包。排除账本、缓存和私密附件。
func (s *Service) ExportSkillPackage(dirRel string) (ShelfManifest, error) {
	if s == nil || s.dataDir == "" {
		return ShelfManifest{}, fmt.Errorf("笔记本未就绪")
	}
	abs, rel, err := s.ResolveDirRel(dirRel)
	if err != nil {
		return ShelfManifest{}, err
	}
	root := firstPathSegment(rel)
	if !IsSystemTopDir(root) {
		return ShelfManifest{}, fmt.Errorf("只能导出业务根下的技能目录")
	}
	skillPath := filepath.Join(abs, SkillEntryFile)
	raw, err := os.ReadFile(skillPath)
	if err != nil {
		return ShelfManifest{}, fmt.Errorf("目录里没有 %s", SkillEntryFile)
	}
	version, err := shelfVersion(abs)
	if err != nil {
		return ShelfManifest{}, err
	}
	fm, _, _ := splitFrontmatterMap(string(raw))
	name := firstNonEmpty(fmString(fm, "name"), filepath.Base(rel))
	manifest := ShelfManifest{
		ID:          rel,
		Name:        name,
		Version:     version,
		Root:        root,
		Bind:        fmString(fm, "bind"),
		Intent:      fmString(fm, "intent"),
		Description: fmString(fm, "description"),
		Limits:      append([]string(nil), ShelfLimits...),
		ExportedAt:  time.Now().Format(time.RFC3339),
	}
	dest := s.shelfPackageDir(rel, version)
	if err := os.RemoveAll(dest); err != nil {
		return ShelfManifest{}, err
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return ShelfManifest{}, err
	}
	files, err := copyShelfTree(abs, dest)
	if err != nil {
		return ShelfManifest{}, err
	}
	if !containsPath(files, SkillEntryFile) {
		return ShelfManifest{}, fmt.Errorf("导出后缺少 %s", SkillEntryFile)
	}
	manifest.Files = files
	if err := writeJSON(filepath.Join(dest, "manifest.json"), manifest); err != nil {
		return ShelfManifest{}, err
	}
	return manifest, nil
}

// ReadShelfBodies 读出货架上某个版本的正文，供上架到商店。
func (s *Service) ReadShelfBodies(id, version string) (map[string]string, error) {
	if s == nil || s.dataDir == "" {
		return nil, fmt.Errorf("笔记本未就绪")
	}
	id = strings.Trim(filepath.ToSlash(strings.TrimSpace(id)), "/")
	version = strings.TrimSpace(version)
	var manifest ShelfManifest
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
	if _, ok := bodies[SkillEntryFile]; !ok {
		return nil, fmt.Errorf("导出后缺少 %s", SkillEntryFile)
	}
	return bodies, nil
}

// MaterializeShelfPackage 把商店下载的包写进本机货架，不安装。
func (s *Service) MaterializeShelfPackage(manifest ShelfManifest, bodies map[string]string) error {
	if s == nil || s.dataDir == "" {
		return fmt.Errorf("笔记本未就绪")
	}
	id := strings.Trim(filepath.ToSlash(strings.TrimSpace(manifest.ID)), "/")
	version := strings.TrimSpace(manifest.Version)
	if id == "" || version == "" || strings.Contains(id, "..") || strings.Contains(version, "..") || strings.Contains(version, "/") {
		return fmt.Errorf("无效的技能包")
	}
	kept := map[string]string{}
	for rel, body := range bodies {
		rel = filepath.ToSlash(strings.TrimSpace(rel))
		if includeShelfFile(rel) {
			kept[rel] = body
		}
	}
	if _, ok := kept[SkillEntryFile]; !ok {
		return fmt.Errorf("技能包缺少 %s", SkillEntryFile)
	}
	names := make([]string, 0, len(kept))
	for name := range kept {
		names = append(names, name)
	}
	sort.Strings(names)
	manifest.ID = id
	manifest.Version = version
	manifest.Files = names
	if len(manifest.Limits) == 0 {
		manifest.Limits = append([]string(nil), ShelfLimits...)
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
	return writeJSON(filepath.Join(dest, "manifest.json"), manifest)
}

// ListSkillShelf 列出本机货架，并标出是否已装进笔记本。
func (s *Service) ListSkillShelf() ([]ShelfCard, error) {
	if s == nil || s.dataDir == "" {
		return nil, fmt.Errorf("笔记本未就绪")
	}
	root := s.shelfRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []ShelfCard{}, nil
		}
		return nil, err
	}
	var cards []ShelfCard
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
			var manifest ShelfManifest
			path := filepath.Join(root, ent.Name(), ver.Name(), "manifest.json")
			if err := readJSON(path, &manifest); err != nil || manifest.ID == "" || manifest.Version == "" {
				continue
			}
			card := ShelfCard{ShelfManifest: manifest, State: "available"}
			if rel, ok := s.installedShelfRel(manifest.ID, manifest.Version); ok {
				card.Installed = true
				card.InstalledRel = rel
				card.State = "installed"
			}
			if len(card.Limits) == 0 {
				card.Limits = append([]string(nil), ShelfLimits...)
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
		cards = []ShelfCard{}
	}
	return cards, nil
}

// InstallSkillPackage 把货架上的一个版本装进对应业务根并打目录版本。
// 目标目录已有未纳入版本的改动时，并排安装，不覆盖。
func (s *Service) InstallSkillPackage(id, version string) (ShelfInstallResult, error) {
	if s == nil || s.dataDir == "" {
		return ShelfInstallResult{}, fmt.Errorf("笔记本未就绪")
	}
	id = strings.Trim(filepath.ToSlash(strings.TrimSpace(id)), "/")
	version = strings.TrimSpace(version)
	if id == "" || version == "" || strings.Contains(id, "..") {
		return ShelfInstallResult{}, fmt.Errorf("无效的技能包")
	}
	pkg := s.shelfPackageDir(id, version)
	var manifest ShelfManifest
	if err := readJSON(filepath.Join(pkg, "manifest.json"), &manifest); err != nil {
		return ShelfInstallResult{}, fmt.Errorf("货架上没有这个版本")
	}
	if manifest.ID != id || manifest.Version != version {
		return ShelfInstallResult{}, fmt.Errorf("清单与目录不一致")
	}
	if rel, ok := s.installedShelfRel(id, version); ok {
		return ShelfInstallResult{Rel: rel, Version: version, Already: true}, nil
	}
	destRel := id
	side := false
	if s.shelfTargetBusy(id, pkg) {
		destRel = id + "@" + version
		side = true
	}
	destAbs := filepath.Join(s.workspaceRoot(), filepath.FromSlash(destRel))
	if err := os.MkdirAll(destAbs, 0o700); err != nil {
		return ShelfInstallResult{}, err
	}
	if err := copyPackageFiles(pkg, destAbs, manifest.Files); err != nil {
		return ShelfInstallResult{}, err
	}
	if err := writeJSON(filepath.Join(destAbs, shelfMarkerName), shelfMarker{ID: id, Version: version}); err != nil {
		return ShelfInstallResult{}, err
	}
	pinned, err := s.PinDirVersion(destRel, "shelf: "+version)
	if err != nil {
		return ShelfInstallResult{}, err
	}
	return ShelfInstallResult{
		Rel: destRel, Version: version, SideBySide: side, Pinned: pinned.Short,
	}, nil
}

func (s *Service) shelfRoot() string {
	return filepath.Join(strings.TrimSpace(s.dataDir), ShelfDirName)
}

func (s *Service) shelfPackageDir(id, version string) string {
	return filepath.Join(s.shelfRoot(), shelfEncodeID(id), version)
}

func shelfEncodeID(id string) string {
	return strings.ReplaceAll(filepath.ToSlash(strings.Trim(id, "/")), "/", "__")
}

func (s *Service) installedShelfRel(id, version string) (string, bool) {
	pkgHash := fileSHA(filepath.Join(s.shelfPackageDir(id, version), SkillEntryFile))
	for _, rel := range []string{id, id + "@" + version} {
		var marker shelfMarker
		dir := filepath.Join(s.workspaceRoot(), filepath.FromSlash(rel))
		if err := readJSON(filepath.Join(dir, shelfMarkerName), &marker); err != nil {
			continue
		}
		if marker.ID == id && marker.Version == version && fileSHA(filepath.Join(dir, SkillEntryFile)) == pkgHash {
			return rel, true
		}
	}
	return "", false
}

func (s *Service) shelfTargetBusy(id, pkg string) bool {
	abs := filepath.Join(s.workspaceRoot(), filepath.FromSlash(id))
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return false
	}
	skill := filepath.Join(abs, SkillEntryFile)
	if _, err := os.Stat(skill); err != nil {
		entries, _ := os.ReadDir(abs)
		return len(entries) > 0
	}
	if dirDirty(abs) {
		return true
	}
	pkgSkill := filepath.Join(pkg, SkillEntryFile)
	return fileSHA(skill) != fileSHA(pkgSkill)
}

func dirDirty(abs string) bool {
	if !dirgit.IsRepo(abs) {
		return false
	}
	st, err := dirgit.StatusOf(abs, 1)
	if err != nil {
		return true
	}
	return st.Working
}

func shelfVersion(abs string) (string, error) {
	st, err := dirgit.StatusOf(abs, 1)
	if err != nil {
		return "", err
	}
	if st.Enabled && st.Head != "" && !st.Working {
		short := st.Head
		if len(short) > 7 {
			short = short[:7]
		}
		return short, nil
	}
	sum := fileSHA(filepath.Join(abs, SkillEntryFile))
	if len(sum) > 8 {
		sum = sum[:8]
	}
	return time.Now().Format("20060102-150405") + "-" + sum, nil
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
	if rel == SkillEntryFile {
		return true
	}
	return strings.HasPrefix(rel, SkillScriptsDir+"/") || strings.HasPrefix(rel, SkillAssetsDir+"/")
}

func skipShelfDir(name string) bool {
	if name == "" || strings.HasPrefix(name, ".") {
		return true
	}
	return name == "__pycache__" || name == "node_modules"
}

func fileSHA(path string) string {
	body, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return sha256Sum(body)
}

func sha256Sum(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func jsonMarshal(v any) ([]byte, error) {
	return json.MarshalIndent(v, "", "  ")
}

func jsonUnmarshal(body []byte, v any) error {
	return json.Unmarshal(body, v)
}

func sortStrings(items []string) {
	sort.Strings(items)
}

func firstPathSegment(rel string) string {
	rel = strings.Trim(filepath.ToSlash(rel), "/")
	if i := strings.IndexByte(rel, '/'); i >= 0 {
		return rel[:i]
	}
	return rel
}

func containsPath(files []string, want string) bool {
	for _, f := range files {
		if f == want {
			return true
		}
	}
	return false
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func readJSON(path string, v any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

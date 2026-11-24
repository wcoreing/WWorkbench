package notebook

import (
	"fmt"
	"path/filepath"

	"WWorkbench/internal/skill"
	"WWorkbench/internal/skill/fsstore"
)

const (
	// ShelfDirName 本机技能货架（与 notebook 并列，不进笔记本版本仓）。
	ShelfDirName = "skill-shelf"
)

// ShelfLimits 每张货架卡片都带上的边界，避免把安装理解成代操作。
var ShelfLimits = append([]string(nil), skill.DefaultLimits...)

// ShelfManifest 一个可安装的技能版本包（兼容旧 API；真源为 skill.Bundle）。
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

// ShelfCard 货架上的一张卡。
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

func (s *Service) skillStore() skill.Store {
	if s == nil || s.dataDir == "" {
		return nil
	}
	return fsstore.New(fsstore.Options{
		DataDir:     s.dataDir,
		PackageRoot: s.workspaceRoot(),
		PreferRoots: SystemTopDirs(),
		DefaultRoot: SkillGroupName,
	})
}

// ExportSkillPackage 委托 skill.Store.Export。
func (s *Service) ExportSkillPackage(dirRel string) (ShelfManifest, error) {
	st := s.skillStore()
	if st == nil {
		return ShelfManifest{}, fmt.Errorf("笔记本未就绪")
	}
	b, err := st.Export(dirRel)
	if err != nil {
		return ShelfManifest{}, err
	}
	return manifestFromBundle(b), nil
}

// ReadShelfBodies 委托 skill.Store.ReadBundleBodies。
func (s *Service) ReadShelfBodies(id, version string) (map[string]string, error) {
	st := s.skillStore()
	if st == nil {
		return nil, fmt.Errorf("笔记本未就绪")
	}
	return st.ReadBundleBodies(id, version)
}

// MaterializeShelfPackage 委托 skill.Store.Materialize。
func (s *Service) MaterializeShelfPackage(manifest ShelfManifest, bodies map[string]string) error {
	st := s.skillStore()
	if st == nil {
		return fmt.Errorf("笔记本未就绪")
	}
	b := bundleFromManifest(manifest)
	b.Bodies = bodies
	return st.Materialize(b)
}

// ListSkillShelf 委托 skill.Store.ListShelf。
func (s *Service) ListSkillShelf() ([]ShelfCard, error) {
	st := s.skillStore()
	if st == nil {
		return nil, fmt.Errorf("笔记本未就绪")
	}
	cards, err := st.ListShelf()
	if err != nil {
		return nil, err
	}
	out := make([]ShelfCard, 0, len(cards))
	for _, c := range cards {
		out = append(out, ShelfCard{
			ShelfManifest: manifestFromBundle(c.Bundle),
			Installed:     c.Installed,
			InstalledRel:  c.InstalledRel,
			State:         c.State,
		})
	}
	return out, nil
}

// InstallSkillPackage 委托 skill.Store.Install。
func (s *Service) InstallSkillPackage(id, version string) (ShelfInstallResult, error) {
	st := s.skillStore()
	if st == nil {
		return ShelfInstallResult{}, fmt.Errorf("笔记本未就绪")
	}
	r, err := st.Install(id, version)
	if err != nil {
		return ShelfInstallResult{}, err
	}
	return ShelfInstallResult{
		Rel: r.Rel, Version: r.Version, SideBySide: r.SideBySide,
		Pinned: r.Pinned, Already: r.Already,
	}, nil
}

func manifestFromBundle(b skill.Bundle) ShelfManifest {
	limits := b.Limits
	if len(limits) == 0 {
		limits = append([]string(nil), ShelfLimits...)
	}
	return ShelfManifest{
		ID: b.ID, Name: b.Name, Version: b.Version, Root: b.Root,
		Bind: b.Bind, Intent: b.Intent, Description: b.Description,
		Limits: limits, ExportedAt: b.ExportedAt, Files: b.Files,
		SharedBy: b.SharedBy, SharedAt: b.SharedAt,
	}
}

func bundleFromManifest(m ShelfManifest) skill.Bundle {
	limits := m.Limits
	if len(limits) == 0 {
		limits = append([]string(nil), ShelfLimits...)
	}
	return skill.Bundle{
		ID: m.ID, Name: m.Name, Version: m.Version, Root: m.Root,
		Bind: m.Bind, Intent: m.Intent, Description: m.Description,
		Limits: limits, ExportedAt: m.ExportedAt, Files: m.Files,
		SharedBy: m.SharedBy, SharedAt: m.SharedAt,
	}
}

func containsPath(files []string, want string) bool {
	want = filepath.ToSlash(want)
	for _, f := range files {
		if filepath.ToSlash(f) == want {
			return true
		}
	}
	return false
}

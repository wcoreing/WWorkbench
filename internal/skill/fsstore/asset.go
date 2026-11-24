package fsstore

import (
	"fmt"
	"os"
	"path/filepath"

	"WWorkbench/internal/file"
	"WWorkbench/internal/resource"
	"WWorkbench/internal/skill"
)

// AttachAsset 复制本机文件到包目录 assets/，并写入本地资源账本。
func (s *Store) AttachAsset(ref, srcAbsPath string) (skill.Asset, error) {
	if err := s.ready(); err != nil {
		return skill.Asset{}, err
	}
	e, err := s.resolveEntry(ref, true)
	if err != nil {
		return skill.Asset{}, err
	}
	_ = os.MkdirAll(filepath.Join(e.absDir, "scripts"), 0o700)
	doc, err := s.files.Ensure(e.relEntry)
	if err != nil {
		return skill.Asset{}, err
	}
	place, err := file.Placement(s.packageRoot, doc)
	if err != nil {
		return skill.Asset{}, err
	}
	items, err := resource.New(s.dataDir).Import(resource.Slot{
		OwnerID:    place.FileID,
		Dir:        place.Dir,
		LinkPrefix: place.LinkPrefix,
	}, []string{srcAbsPath})
	if err != nil {
		return skill.Asset{}, err
	}
	if len(items) == 0 {
		return skill.Asset{}, fmt.Errorf("未写入资源")
	}
	it := items[0]
	return skill.Asset{
		Name:     it.Name,
		RelPath:  it.RelLink(),
		Markdown: it.Markdown(),
		IsImage:  resource.IsImageMIME(it.MIME),
		Size:     it.Size,
	}, nil
}

package workbenchtools

import (
	"path/filepath"
	"testing"

	"WWorkbench/internal/model"
)

func TestProjectSSHHostIDs_CapAndDedupe(t *testing.T) {
	p := model.WorkbenchProjectDO{
		Links: []model.WorkbenchProjectLinkDO{
			{Kind: "ssh", ID: "a"},
			{Kind: "database", ID: "db1"},
			{Kind: "ssh", ID: "a"},
			{Kind: "SSH", ID: "b"},
			{Kind: "ssh", ID: "c"},
			{Kind: "ssh", ID: "d"},
		},
	}
	ids, omitted := projectSSHHostIDs(p, 3)
	if len(ids) != 3 || omitted != 1 {
		t.Fatalf("ids=%v omitted=%d", ids, omitted)
	}
	if ids[0] != "a" || ids[1] != "b" || ids[2] != "c" {
		t.Fatalf("order: %v", ids)
	}
}

func TestNormalizeLocalPath(t *testing.T) {
	dir := t.TempDir()
	abs, err := NormalizeLocalPath(filepath.Join(dir, ".", "x"))
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(abs) {
		t.Fatalf("not abs: %s", abs)
	}
}

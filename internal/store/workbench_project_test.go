package store

import (
	"testing"

	"WWorkbench/internal/model"
)

func TestWorkbenchProjectCRUD(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	saved, err := s.SaveWorkbenchProject(model.WorkbenchProjectDO{
		Name:      "demo",
		LocalPath: "/tmp/demo",
		Links: []model.WorkbenchProjectLinkDO{
			{Kind: "ssh", ID: "h1", Label: "Host"},
			{Kind: "ssh", ID: "h1", Label: "dup"},
			{Kind: "database", ID: "c1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || len(saved.Links) != 2 {
		t.Fatalf("unexpected saved: %+v", saved)
	}

	got, err := s.GetWorkbenchProject(saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LocalPath != "/tmp/demo" || got.Name != "demo" {
		t.Fatalf("get mismatch: %+v", got)
	}

	list, err := s.ListWorkbenchProjects()
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%v err=%v", list, err)
	}

	if err := s.DeleteWorkbenchProject(saved.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetWorkbenchProject(saved.ID); err == nil {
		t.Fatal("expected not found")
	}
}

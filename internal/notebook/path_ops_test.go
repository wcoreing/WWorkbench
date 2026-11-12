package notebook

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPathOpsRenameMoveCopy(t *testing.T) {
	dir := t.TempDir()
	s := &Service{dataDir: dir}
	if err := s.EnsureFSNotebook(); err != nil {
		t.Fatal(err)
	}
	mem := filepath.Join(s.workspaceRoot(), MemoryGroupName)
	src := filepath.Join(mem, "alpha.md")
	if err := os.WriteFile(src, []byte("hi"), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := s.RenameRel(MemoryGroupName+"/alpha.md", "beta.md")
	if err != nil {
		t.Fatal(err)
	}
	if m.To != MemoryGroupName+"/beta.md" {
		t.Fatalf("rename to=%s", m.To)
	}
	sub, err := s.CreateDir(MemoryGroupName, "box")
	if err != nil {
		t.Fatal(err)
	}
	m, err = s.MoveRel(MemoryGroupName+"/beta.md", sub)
	if err != nil {
		t.Fatal(err)
	}
	if m.To != MemoryGroupName+"/box/beta.md" {
		t.Fatalf("move to=%s", m.To)
	}
	m, err = s.CopyRel(m.To, MemoryGroupName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.workspaceRoot(), filepath.FromSlash(m.To))); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteRel(sub); err != nil {
		t.Fatal(err)
	}
}

func TestRenameKeepsJsExt(t *testing.T) {
	dir := t.TempDir()
	s := &Service{dataDir: dir}
	if err := s.EnsureFSNotebook(); err != nil {
		t.Fatal(err)
	}
	mem := filepath.Join(s.workspaceRoot(), MemoryGroupName)
	src := filepath.Join(mem, "a.md")
	if err := os.WriteFile(src, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := s.RenameRel(MemoryGroupName+"/a.md", "index.js")
	if err != nil {
		t.Fatal(err)
	}
	if m.To != MemoryGroupName+"/index.js" {
		t.Fatalf("want index.js got %s", m.To)
	}
	if _, err := os.Stat(filepath.Join(mem, "index.js")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(mem, "index.js.md")); err == nil {
		t.Fatal("must not create index.js.md")
	}
	list, err := s.ListNotes()
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, n := range list {
		if n.ID == MemoryGroupName+"/index.js" {
			found = true
			if n.Language != "javascript" {
				t.Fatalf("language=%s", n.Language)
			}
			if n.Title != "index" {
				t.Fatalf("title=%s", n.Title)
			}
		}
	}
	if !found {
		t.Fatal("index.js not listed")
	}
}

func TestPathOpsProtectSystemDirs(t *testing.T) {
	dir := t.TempDir()
	s := &Service{dataDir: dir}
	_ = s.EnsureFSNotebook()
	if _, err := s.RenameRel(SkillGroupName, "x"); err == nil {
		t.Fatal("expected protect rename")
	}
	if err := s.DeleteRel(MemoryGroupName); err == nil {
		t.Fatal("expected protect delete")
	}
}

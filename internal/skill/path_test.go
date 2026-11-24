package skill

import "testing"

func TestEntryInDirAndDirFromEntry(t *testing.T) {
	got := EntryInDir("项目/WWorkbench")
	if got != "项目/WWorkbench/SKILL.md" {
		t.Fatalf("EntryInDir: %q", got)
	}
	dir := DirFromEntry(got)
	if dir != "项目/WWorkbench" {
		t.Fatalf("DirFromEntry: %q", dir)
	}
	if FirstRoot(got) != "项目" {
		t.Fatalf("FirstRoot: %q", FirstRoot(got))
	}
	if Basename(got) != "WWorkbench" {
		t.Fatalf("Basename: %q", Basename(got))
	}
}

func TestDirFromEntryRejectsPlain(t *testing.T) {
	if DirFromEntry("项目/WWorkbench") != "" {
		t.Fatal("expected empty for non-entry")
	}
}

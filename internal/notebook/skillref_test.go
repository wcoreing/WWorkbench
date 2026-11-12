package notebook

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestSkillNoteIDRootsAndShort(t *testing.T) {
	if got := SkillNoteID("demo"); got != "工作流/demo/SKILL.md" {
		t.Fatalf("short=%q", got)
	}
	if got := SkillNoteID("运维"); got != "运维/SKILL.md" {
		t.Fatalf("ops root=%q", got)
	}
	if got := SkillNoteID("记忆区/h/项目/x"); got != "记忆区/h/项目/x/SKILL.md" {
		t.Fatalf("path=%q", got)
	}
	if got := SkillEntryIDInDir("运维"); got != "运维/SKILL.md" {
		t.Fatalf("entry in dir=%q", got)
	}
}

func TestMarkNoteAsSkillStaysInPlace(t *testing.T) {
	dir := t.TempDir()
	s := NewService(nil, dir)
	relDir := "记忆区/prod/项目/dwq"
	absDir := filepath.Join(s.workspaceRoot(), filepath.FromSlash(relDir))
	if err := os.MkdirAll(absDir, 0o700); err != nil {
		t.Fatal(err)
	}
	srcID := relDir + "/草稿.md"
	if err := os.WriteFile(filepath.Join(absDir, "草稿.md"), []byte("# draft\n\nbody\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved, err := s.MarkNoteAsSkill(srcID, "dwq-deploy")
	if err != nil {
		t.Fatal(err)
	}
	want := relDir + "/" + SkillEntryFile
	if saved.ID != want {
		t.Fatalf("id=%q want %q", saved.ID, want)
	}
	if _, err := os.Stat(filepath.Join(absDir, SkillEntryFile)); err != nil {
		t.Fatal("skill missing in place")
	}
	if _, err := os.Stat(filepath.Join(s.workspaceRoot(), SkillGroupName, "dwq-deploy", SkillEntryFile)); err == nil {
		t.Fatal("must not migrate to 工作流/")
	}
	if !strings.Contains(saved.Content, "skillId: dwq-deploy") && !strings.Contains(saved.Content, "name: dwq-deploy") {
		t.Fatalf("frontmatter missing: %s", saved.Content)
	}
}

func TestPublishSkillToTaskRoot(t *testing.T) {
	dir := t.TempDir()
	s := NewService(nil, dir)
	relDir := "记忆区/prod"
	absDir := filepath.Join(s.workspaceRoot(), filepath.FromSlash(relDir))
	if err := os.MkdirAll(absDir, 0o700); err != nil {
		t.Fatal(err)
	}
	srcID := relDir + "/临时.md"
	if err := os.WriteFile(filepath.Join(absDir, "临时.md"), []byte("# tmp\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved, err := s.PublishSkillToTaskRoot(srcID, "tmp-skill")
	if err != nil {
		t.Fatal(err)
	}
	want := SkillGroupName + "/tmp-skill/" + SkillEntryFile
	if saved.ID != want {
		t.Fatalf("id=%q want %q", saved.ID, want)
	}
	if NormalizeNoteRole(saved.Role) != model.NoteRoleSkill {
		t.Fatalf("role=%q", saved.Role)
	}
}

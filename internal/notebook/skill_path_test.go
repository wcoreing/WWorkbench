package notebook

import (
	"os"
	"path/filepath"
	"testing"

	"WWorkbench/internal/model"
)

func TestSkillProtocolUnderMemoryProject(t *testing.T) {
	dir := t.TempDir()
	s := NewService(nil, dir)
	rel := "记忆区/prod/项目/dwq"
	noteID := rel + "/" + SkillEntryFile
	absDir := filepath.Join(s.workspaceRoot(), filepath.FromSlash(rel))
	if err := os.MkdirAll(absDir, 0o700); err != nil {
		t.Fatal(err)
	}
	content := "---\nrole: skill\nname: dwq\n---\n\n# dwq 部署\n\n```wwb-skill-steps\n[{\"action\":\"shell_run\",\"summary\":\"pull\"}]\n```\n"
	if err := os.WriteFile(filepath.Join(absDir, SkillEntryFile), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	if !isSkillPathID(noteID) {
		t.Fatal("expected skill path")
	}
	if got := SkillNameFromNoteID(noteID); got != rel {
		t.Fatalf("name=%q", got)
	}
	if got := SkillNoteID(rel); got != noteID {
		t.Fatalf("SkillNoteID=%q", got)
	}

	n, err := s.GetNote(noteID)
	if err != nil || n == nil {
		t.Fatalf("get: %v", err)
	}
	if NormalizeNoteRole(n.Role) != model.NoteRoleSkill {
		t.Fatalf("role=%q", n.Role)
	}
	if found := s.FindNoteIDBySkillID(rel); found != noteID {
		t.Fatalf("find path=%q", found)
	}
	if found := s.FindNoteIDBySkillID("dwq"); found != noteID {
		t.Fatalf("find short=%q", found)
	}
	got, err := s.GetWorkflowNote(rel)
	if err != nil {
		t.Fatal(err)
	}
	if got.NoteID != noteID {
		t.Fatalf("resolve noteId=%q", got.NoteID)
	}

	// 就地 SaveNote 不得迁到 工作流/
	n.Content = n.Content + "\n<!-- keep -->\n"
	saved, err := s.SaveNote(*n)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != noteID {
		t.Fatalf("save moved id to %q", saved.ID)
	}
	if _, err := os.Stat(filepath.Join(absDir, SkillEntryFile)); err != nil {
		t.Fatal("memory skill file missing after save")
	}
	if _, err := os.Stat(filepath.Join(s.workspaceRoot(), SkillGroupName, "dwq", SkillEntryFile)); err == nil {
		t.Fatal("must not create 工作流/dwq copy")
	}
}

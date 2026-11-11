package notebook

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestSyncNoteMetaFromFrontmatterWhenRoleUnset(t *testing.T) {
	n := model.NoteDO{
		Title:   "坑",
		Content: "---\nrole: memory\nsshHostId: host-1\n---\n\n别重启 MySQL 乱改 my.cnf\n",
	}
	SyncNoteMeta(&n)
	if n.Role != model.NoteRoleMemory {
		t.Fatalf("role=%q", n.Role)
	}
	if n.SSHHostID != "host-1" {
		t.Fatalf("ssh=%q", n.SSHHostID)
	}
}

func TestSyncNoteMetaColumnWinsOverFrontmatter(t *testing.T) {
	n := model.NoteDO{
		Title:   "坑",
		Content: "---\nrole: memory\n---\n\n正文\n",
		Role:    model.NoteRoleNote,
	}
	SyncNoteMeta(&n)
	if n.Role != model.NoteRoleNote {
		t.Fatalf("role=%q want note", n.Role)
	}
	if strings.Contains(n.Content, "role: memory") {
		t.Fatalf("stale memory role left in content: %s", n.Content)
	}
}

func TestSyncNoteMetaWriteFrontmatter(t *testing.T) {
	n := model.NoteDO{
		Title:     "习惯",
		Content:   "先看磁盘再上线",
		Role:      model.NoteRoleMemory,
		SSHHostID: "h2",
	}
	SyncNoteMeta(&n)
	if !strings.Contains(n.Content, "role: memory") {
		t.Fatalf("content missing role: %s", n.Content)
	}
	if !strings.Contains(n.Content, "sshHostId: h2") {
		t.Fatalf("content missing ssh: %s", n.Content)
	}
}

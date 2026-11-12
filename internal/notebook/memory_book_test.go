package notebook

import "testing"

func TestMemoryBookDirRel(t *testing.T) {
	if got := MemoryBookDirRel("prod / api"); got != "记忆区/prod  api" {
		t.Fatalf("got %q", got)
	}
	if MemoryBookDirName("") != "未命名主机" {
		t.Fatalf("empty name")
	}
	if MemoryBookIndexNoteID("web") != "记忆区/web/主机记忆.md" {
		t.Fatalf("index=%q", MemoryBookIndexNoteID("web"))
	}
}

func TestNoteUnderBooklet(t *testing.T) {
	if !NoteUnderBooklet("记忆区/web/主机记忆.md", []string{"记忆区/web"}) {
		t.Fatal("expected under booklet")
	}
	if NoteUnderBooklet("记忆区/other/x.md", []string{"记忆区/web"}) {
		t.Fatal("should not match other booklet")
	}
}

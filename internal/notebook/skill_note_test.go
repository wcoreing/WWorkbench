package notebook

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestSkillBodyFromNoteStripsMarkAndFrontmatter(t *testing.T) {
	content := "---\nrole: skill\nname: demo\n---\n\n<!-- wwb-skill: demo -->\n\n# Hello\n\nDo the thing.\n"
	body := SkillBodyFromNote(content)
	if strings.Contains(body, "wwb-skill") || strings.Contains(body, "role:") {
		t.Fatalf("body still has meta: %q", body)
	}
	if !strings.Contains(body, "Hello") {
		t.Fatalf("body=%q", body)
	}
}

func TestSuggestSkillID(t *testing.T) {
	if id := SuggestSkillID("My Cool Skill", "abc"); id != "my-cool-skill" {
		t.Fatalf("id=%q", id)
	}
	if id := SuggestSkillID("中文标题", "note-xyz123"); !strings.HasPrefix(id, "note-") {
		t.Fatalf("id=%q", id)
	}
}

func TestWithLinkedSkillIDKeepsFrontmatterFirst(t *testing.T) {
	n := model.NoteDO{Content: "---\nrole: note\n---\n\nbody"}
	out := WithLinkedSkillID(n.Content, "demo")
	if !strings.HasPrefix(strings.TrimLeft(out, " \t\r\n"), "---") {
		t.Fatalf("frontmatter not first: %s", out)
	}
	if ReadLinkedSkillID(out) != "demo" {
		t.Fatalf("mark missing: %s", out)
	}
}

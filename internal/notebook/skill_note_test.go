package notebook

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestSkillNameFromNoteIDOnlySKILL(t *testing.T) {
	if got := SkillNameFromNoteID("工作流/小红书发布/SKILL.md"); got != "小红书发布" {
		t.Fatalf("SKILL: got %q", got)
	}
	if got := SkillNameFromNoteID("工作流/小红书发布/skill.md"); got != "小红书发布" {
		t.Fatalf("case: got %q", got)
	}
	if got := SkillNameFromNoteID("工作流/小红书发布/log.md"); got != "" {
		t.Fatalf("log must not map to skill name: %q", got)
	}
	if got := SkillNameFromNoteID("工作流/小红书发布/notes.md"); got != "" {
		t.Fatalf("other md: %q", got)
	}
	if got := SkillNameFromNoteID("工作流/小红书发布"); got != "" {
		t.Fatalf("dir only: %q", got)
	}
	if got := SkillNameFromNoteID("记忆区/prod/项目/dwq/SKILL.md"); got != "记忆区/prod/项目/dwq" {
		t.Fatalf("memory project skill: got %q", got)
	}
	if got := SkillNoteID("记忆区/prod/项目/dwq"); got != "记忆区/prod/项目/dwq/SKILL.md" {
		t.Fatalf("path SkillNoteID: got %q", got)
	}
	if got := SkillNoteID("demo"); got != "工作流/demo/SKILL.md" {
		t.Fatalf("short SkillNoteID: got %q", got)
	}
	if !IsTaskLogNoteID("工作流/小红书发布/log.md") {
		t.Fatal("expected task log id")
	}
	if !IsTaskLogNoteID("记忆区/prod/项目/dwq/log.md") {
		t.Fatal("memory project log should count as task log")
	}
	if IsTaskLogNoteID("工作流/小红书发布/SKILL.md") {
		t.Fatal("SKILL is not task log")
	}
}

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

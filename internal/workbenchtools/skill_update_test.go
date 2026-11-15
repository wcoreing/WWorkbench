package workbenchtools

import (
	"testing"

	"WWorkbench/internal/model"
)

func TestNormalizeSkillContent(t *testing.T) {
	a := "hello\r\nworld\r\n"
	b := "hello\nworld"
	if normalizeSkillContent(a) != normalizeSkillContent(b) {
		t.Fatalf("newline normalize mismatch: %q vs %q", normalizeSkillContent(a), normalizeSkillContent(b))
	}
	if normalizeSkillContent("  x  ") != "x" {
		t.Fatalf("trim failed")
	}
}

func TestTextAlreadyInSection(t *testing.T) {
	sec := "- [2026-11-15 09:00] 宏须带 session\n- [2026-11-15 09:01] 其它"
	if !textAlreadyInSection(sec, "宏须带 session") {
		t.Fatal("expected duplicate lesson detected")
	}
	if textAlreadyInSection(sec, "全新经验") {
		t.Fatal("new lesson should not count as present")
	}
	if textAlreadyInSection("（尚无沉淀；跑通或踩坑后 update_skill）", "任意") {
		t.Fatal("placeholder section should allow append")
	}
}

func TestUpdateSkillReplaceSteps(t *testing.T) {
	a := UpdateSkillArgs{}
	if updateSkillReplaceSteps(a) {
		t.Fatal("empty steps")
	}
	b := UpdateSkillArgs{Steps: []model.WorkflowStepDO{{Action: "navigate"}}}
	if !updateSkillReplaceSteps(b) {
		t.Fatal("default replace when steps set")
	}
	f := false
	b.ReplaceSteps = &f
	if updateSkillReplaceSteps(b) {
		t.Fatal("explicit false")
	}
}

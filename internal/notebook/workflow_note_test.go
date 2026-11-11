package notebook

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestFormatParseWorkflowNoteRoundTrip(t *testing.T) {
	src := model.WorkflowDO{
		Name:        "xhs-hot-browse",
		Title:       "小红书逛热门",
		Description: "打开探索后暂停",
		Intent:      "逛热门",
		SourceRunID: "seed",
		Steps: []model.WorkflowStepDO{
			{Action: "navigate", Summary: "打开探索", Locator: map[string]interface{}{"url": "https://www.xiaohongshu.com/explore"}},
			{Action: "pause", Summary: "请人点一条"},
		},
	}
	content := FormatWorkflowNoteContent(src, WorkflowNoteBodyExtras{})
	if !strings.Contains(content, "role: skill") || !strings.Contains(content, "```wwb-skill-steps") {
		t.Fatalf("bad content: %s", content)
	}
	if !strings.Contains(content, "## 说明") || !strings.Contains(content, "## 经验") ||
		!strings.Contains(content, "## 脚本") || !strings.Contains(content, "## 资源") {
		t.Fatalf("missing workflow sections: %s", content)
	}
	extras := ExtractWorkflowNoteBodyExtras(content)
	if extras.Lessons == "" || extras.Scripts == "" || extras.Resources == "" {
		t.Fatalf("extract extras empty: %+v", extras)
	}
	if !strings.Contains(extras.Resources, "assets/") {
		t.Fatalf("resources should point at skill assets dir: %s", extras.Resources)
	}
	n := model.NoteDO{
		ID: SkillNoteID(src.Name), Title: src.Title, Content: content, Role: model.NoteRoleSkill,
	}
	got, ok := ParseWorkflowNote(n)
	if !ok {
		t.Fatal("parse failed")
	}
	if got.Name != src.Name || len(got.Steps) != 2 || got.Steps[1].Action != "pause" {
		t.Fatalf("got=%+v", got)
	}
	if got.NoteID != n.ID || got.Source != "note" {
		t.Fatalf("meta noteId=%s source=%s", got.NoteID, got.Source)
	}
}

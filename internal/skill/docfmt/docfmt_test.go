package docfmt

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestFormatAndExtractRoundTrip(t *testing.T) {
	src := model.WorkflowDO{
		Name:        "demo",
		Title:       "演示",
		Description: "说明一句",
		Intent:      "测模板",
		NoteID:      "工作流/demo/SKILL.md",
		Steps: []model.WorkflowStepDO{
			{Action: "pause", Summary: "停一下"},
		},
	}
	content := Format(src, BodyExtras{Lessons: "- 第一条经验"})
	if !strings.Contains(content, "## 经验") || !strings.Contains(content, "```wwb-skill-steps") {
		t.Fatalf("missing sections: %s", content)
	}
	ex := ExtractBodyExtras(content)
	if !strings.Contains(ex.Lessons, "第一条经验") {
		t.Fatalf("lessons = %q", ex.Lessons)
	}
	line := FormatResourceLine(ResourceKindFile, "截图", "![a](assets/a.png)")
	if !strings.Contains(line, "kind: file") {
		t.Fatalf("line = %q", line)
	}
}

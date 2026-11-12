package notebook

import (
	"strings"
	"testing"

	"WWorkbench/internal/model"
)

func TestMergeTaskLogMarkdownAppendOnly(t *testing.T) {
	prev := "# 日志 · t\n\n- runId: `a`\n- session: s\n- status: running\n- updated: 2026-01-01 00:00:00\n\n## 思考\n\n1. old thought\n\n## 操作\n\n1. [ok/wwb] click — old\n"
	run := model.TaskRunDO{ID: "a", Title: "t", Session: "s", Status: "done", Intent: "i"}
	steps := []model.TaskStepDO{
		{Seq: 1, Kind: model.TaskStepKindThought, Summary: "old thought"},
		{Seq: 1, Action: "click", Intent: "old", OK: true, Provider: "wwb"},
		{Seq: 2, Kind: model.TaskStepKindThought, Summary: "new thought", Provider: "agent"},
		{Seq: 2, Action: "navigate", Intent: "new op", OK: true, Provider: "wwb"},
	}
	out := MergeTaskLogMarkdown(prev, run, steps)
	if !strings.Contains(out, "1. old thought") || !strings.Contains(out, "2. [agent] new thought") {
		t.Fatalf("thought merge failed:\n%s", out)
	}
	if !strings.Contains(out, "1. [ok/wwb] click — old") || !strings.Contains(out, "2. [ok/wwb] navigate — new op") {
		t.Fatalf("op merge failed:\n%s", out)
	}
	if strings.Count(out, "1. old thought") != 1 {
		t.Fatalf("duplicated old thought:\n%s", out)
	}
	if !strings.Contains(out, "- status: done") {
		t.Fatalf("header not patched:\n%s", out)
	}
}

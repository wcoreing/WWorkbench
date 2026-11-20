package agent

import (
	"encoding/json"
	"testing"

	"WWorkbench/internal/workbenchtools"
)

func TestAttachTeachToEndSkillOnly(t *testing.T) {
	data, _ := json.Marshal(map[string]interface{}{
		"ok": true,
		"suggestedSkill": map[string]interface{}{
			"name": "工作流/网页宏", "askHuman": true, "offerPrompt": "沉淀吗？",
		},
	})
	end := map[string]interface{}{}
	attachTeachToEnd(end, workbenchtools.ToolResult{OK: true, Data: data})
	if end["teach"] != nil {
		t.Fatalf("unexpected teach: %#v", end["teach"])
	}
	sk, ok := end["suggestedSkill"].(map[string]interface{})
	if !ok || sk["name"] != "工作流/网页宏" {
		t.Fatalf("want skill-only payload, got %#v", end)
	}
}

func TestAttachTeachToEndBoth(t *testing.T) {
	data, _ := json.Marshal(map[string]interface{}{
		"teach": map[string]interface{}{"summary": "已完成", "nextSteps": []string{"沉淀"}},
		"suggestedSkill": map[string]interface{}{"name": "运维/告警通知"},
	})
	end := map[string]interface{}{}
	attachTeachToEnd(end, workbenchtools.ToolResult{OK: true, Data: data})
	if end["teach"] == nil || end["suggestedSkill"] == nil {
		t.Fatalf("want both: %#v", end)
	}
}

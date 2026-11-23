package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"WWorkbench/internal/workbench"
)

func TestAttachTeachEnvelopeFail(t *testing.T) {
	res := AttachTeachEnvelope(context.Background(), workbench.CapDesktopAct, nil, Fail("用户已在工作台拒绝：点击"))
	if res.OK {
		t.Fatal("still fail")
	}
	if !hasTeach(res.Data) {
		t.Fatalf("want teach on fail: %s", string(res.Data))
	}
	var m map[string]interface{}
	_ = json.Unmarshal(res.Data, &m)
	teach := m["teach"].(map[string]interface{})
	if !strings.Contains(teach["summary"].(string), "拒绝") {
		t.Fatalf("summary=%v", teach["summary"])
	}
}

func TestAttachTeachEnvelopeBrowserRunSkill(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{"ok": true, "steps": 3})
	res := AttachTeachEnvelope(context.Background(), workbench.CapBrowserRun, json.RawMessage(`{"intent":"登录后台"}`), ToolResult{OK: true, Data: raw})
	if !hasSuggestedSkill(res.Data) {
		t.Fatalf("want suggestedSkill: %s", string(res.Data))
	}
	var m map[string]interface{}
	_ = json.Unmarshal(res.Data, &m)
	sk := m["suggestedSkill"].(map[string]interface{})
	if sk["askHuman"] != true {
		t.Fatal("askHuman required")
	}
}

func TestAttachTeachEnvelopeKeepsExisting(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{
		"ok": true, "teach": Teach{Summary: "已有"}, "suggestedSkill": SuggestedSkill{Name: "运维/x", AskHuman: true},
	})
	res := AttachTeachEnvelope(context.Background(), workbench.CapBrowserRun, nil, ToolResult{OK: true, Data: raw})
	var m map[string]interface{}
	_ = json.Unmarshal(res.Data, &m)
	if m["teach"].(map[string]interface{})["summary"] != "已有" {
		t.Fatal("must not overwrite teach")
	}
	if m["suggestedSkill"].(map[string]interface{})["name"] != "运维/x" {
		t.Fatal("must not overwrite skill")
	}
}

func TestLooksLikeGoalClose(t *testing.T) {
	if !looksLikeGoalClose("发给文件传输助手") {
		t.Fatal("send intent")
	}
	if looksLikeGoalClose("点一下搜索框") {
		t.Fatal("should not treat click as close")
	}
}

func TestAttachTeachEnvelopeShellOps(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{"ok": true})
	args, _ := json.Marshal(map[string]interface{}{
		"intent": "同步配置", "command": "rsync -avz ./a host:/b",
	})
	res := AttachTeachEnvelope(context.Background(), workbench.CapShellRun, args, ToolResult{OK: true, Data: raw})
	if !hasSuggestedSkill(res.Data) {
		t.Fatalf("want suggestedSkill for rsync: %s", string(res.Data))
	}
	var m map[string]interface{}
	_ = json.Unmarshal(res.Data, &m)
	sk := m["suggestedSkill"].(map[string]interface{})
	lessons, _ := sk["lessons"].(string)
	if strings.Contains(lessons, "同步配置") {
		t.Fatalf("lessons must not embed intent: %q", lessons)
	}
}

func TestAttachTeachEnvelopeShellNoise(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{"ok": true})
	args, _ := json.Marshal(map[string]interface{}{
		"intent": "看磁盘", "command": "df -h",
	})
	res := AttachTeachEnvelope(context.Background(), workbench.CapShellRun, args, ToolResult{OK: true, Data: raw})
	if hasSuggestedSkill(res.Data) {
		t.Fatalf("df should not suggest skill: %s", string(res.Data))
	}
}

func TestAttachTeachEnvelopeEnsureBackup(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{"ok": true})
	res := AttachTeachEnvelope(context.Background(), workbench.CapEnsureHostBackupPolicies, nil, ToolResult{OK: true, Data: raw})
	if !hasSuggestedSkill(res.Data) {
		t.Fatalf("want suggestedSkill: %s", string(res.Data))
	}
}

func TestExtractSuggestedSkill(t *testing.T) {
	raw, _ := json.Marshal(map[string]interface{}{
		"ok": true,
		"suggestedSkill": SuggestedSkill{
			Name: "运维/x", Lessons: "l", AskHuman: true, OfferPrompt: "q?",
		},
	})
	sk, ok := extractSuggestedSkill(raw)
	if !ok || sk.Name != "运维/x" || !sk.AskHuman {
		t.Fatalf("got %+v ok=%v", sk, ok)
	}
}

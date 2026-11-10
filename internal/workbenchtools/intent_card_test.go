package workbenchtools

import (
	"encoding/json"
	"testing"

	"WWorkbench/internal/workbench"
)

func TestValidateAndRequiresIntent(t *testing.T) {
	if validateIntent("") == "" {
		t.Fatal("empty intent should fail")
	}
	if validateIntent("测") == "" {
		t.Fatal("too short should fail")
	}
	if validateIntent("test") == "" {
		t.Fatal("placeholder should fail")
	}
	if validateIntent("同步代码到韦宁服务器，不碰 data 库") != "" {
		t.Fatal("good intent should pass")
	}

	shellCmd, _ := json.Marshal(map[string]string{"initialCommand": "ls", "intent": "看目录"})
	if !requiresIntent(workbench.CapShellRun, shellCmd) {
		t.Fatal("shell with command needs intent")
	}
	shellOpen, _ := json.Marshal(map[string]string{"hostId": "h1"})
	if requiresIntent(workbench.CapShellRun, shellOpen) {
		t.Fatal("open terminal only should not need intent")
	}
	roSQL, _ := json.Marshal(map[string]interface{}{"sessionId": "s", "sql": "SELECT 1", "readonly": true})
	if requiresIntent(workbench.CapExecuteSQL, roSQL) {
		t.Fatal("readonly select should not need intent")
	}
	wrSQL, _ := json.Marshal(map[string]interface{}{"sessionId": "s", "sql": "DELETE FROM t", "readonly": false})
	if !requiresIntent(workbench.CapExecuteSQL, wrSQL) {
		t.Fatal("write sql needs intent")
	}
}

func TestEnrichConfirmWithIntent(t *testing.T) {
	intentLogMu.Lock()
	intentLog = nil
	intentLogMu.Unlock()

	args, _ := json.Marshal(map[string]string{"intent": "备份后发布前端", "initialCommand": "rsync -av a/ b/"})
	res := Confirm("p1", "终端注入：同步未排除", map[string]interface{}{"risk": "同步未排除数据文件"})
	out := enrichConfirmWithIntent(workbench.CapShellRun, args, res)
	if out.ConfirmSummary != "备份后发布前端" {
		t.Fatalf("summary=%q", out.ConfirmSummary)
	}
	var preview map[string]interface{}
	_ = json.Unmarshal(out.Data, &preview)
	if preview["intent"] != "备份后发布前端" {
		t.Fatalf("preview=%v", preview)
	}
	cards := ListIntentCards(5)
	if len(cards) == 0 || cards[0].Intent != "备份后发布前端" {
		t.Fatalf("cards=%v", cards)
	}
	MarkLatestIntentApproved(workbench.CapShellRun, "备份后发布前端", true)
	cards = ListIntentCards(1)
	if cards[0].Approved == nil || !*cards[0].Approved {
		t.Fatal("should mark approved")
	}
}

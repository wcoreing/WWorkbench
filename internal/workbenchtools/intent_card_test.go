package workbenchtools

import (
	"context"
	"encoding/json"
	"testing"

	"WWorkbench/internal/workbench"
)

func TestValidateAndRequiresIntent(t *testing.T) {
	if validateIntent("") == "" {
		t.Fatal("empty intent should fail quality check")
	}
	if validateIntent("测") == "" {
		t.Fatal("too short should fail quality check")
	}
	if validateIntent("test") == "" {
		t.Fatal("placeholder should fail quality check")
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

	syn := synthesizeIntent(workbench.CapShellRun, []byte(`{"initialCommand":"rsync -av a/ b/"}`))
	if syn == "" || syn[:len("未声明意图")] != "未声明意图" {
		t.Fatalf("synthesize=%q", syn)
	}
	injected := injectIntentArg([]byte(`{"initialCommand":"ls"}`), "未声明意图 · ls")
	var m map[string]interface{}
	_ = json.Unmarshal(injected, &m)
	if m["intent"] != "未声明意图 · ls" {
		t.Fatalf("inject=%v", m)
	}
}

func TestEnrichConfirmWithIntent(t *testing.T) {
	resetCallerStateForTest(CallerDefault)
	ctx := context.Background()

	args, _ := json.Marshal(map[string]string{"intent": "备份后发布前端", "initialCommand": "rsync -av a/ b/"})
	res := Confirm("p1", "终端注入：同步未排除", map[string]interface{}{"risk": "同步未排除数据文件"})
	out := enrichConfirmWithIntent(ctx, workbench.CapShellRun, args, res)
	if out.ConfirmSummary != "备份后发布前端" {
		t.Fatalf("summary=%q", out.ConfirmSummary)
	}
	var preview map[string]interface{}
	_ = json.Unmarshal(out.Data, &preview)
	if preview["intent"] != "备份后发布前端" {
		t.Fatalf("preview=%v", preview)
	}
	cards := ListIntentCards(ctx, 5)
	if len(cards) == 0 || cards[0].Intent != "备份后发布前端" {
		t.Fatalf("cards=%v", cards)
	}
	MarkLatestIntentApproved(ctx, workbench.CapShellRun, "备份后发布前端", true)
	cards = ListIntentCards(ctx, 1)
	if cards[0].Approved == nil || !*cards[0].Approved {
		t.Fatal("should mark approved")
	}
}

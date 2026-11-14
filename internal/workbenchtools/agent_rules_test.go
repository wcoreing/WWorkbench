package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"WWorkbench/internal/workbench"
)

func TestGetAgentRulesAckAndDomain(t *testing.T) {
	resetCallerStateForTest(CallerDefault)
	ctx := context.Background()
	if AgentRulesAcked(ctx) {
		t.Fatal("should start unacked")
	}
	if !requiresAgentRulesAck(workbench.CapShellRun) {
		t.Fatal("shell_run still listed as hands-on for intent")
	}
	if requiresAgentRulesAck(workbench.CapGetAgentRules) {
		t.Fatal("get_agent_rules must not require ack")
	}

	res := toolGetAgentRules(ctx, nil, nil)
	if !res.OK {
		t.Fatalf("get_agent_rules failed: %s", res.Error)
	}
	if !AgentRulesAcked(ctx) {
		t.Fatal("should be acked after get_agent_rules")
	}

	raw, _ := json.Marshal(map[string]string{"domain": "terminal"})
	res2 := toolGetAgentRules(ctx, nil, raw)
	if !res2.OK {
		t.Fatalf("domain slice failed: %s", res2.Error)
	}
	var out map[string]interface{}
	_ = json.Unmarshal(res2.Data, &out)
	rules, _ := out["rules"].(string)
	if !strings.Contains(rules, "终端") {
		t.Fatalf("terminal slice missing content: %q", truncateRunes(rules, 80))
	}

	st := stateOf(ctx)
	st.mu.Lock()
	st.rulesAckUntil = time.Now().Add(-time.Second).Unix()
	st.mu.Unlock()
	if AgentRulesAcked(ctx) {
		t.Fatal("expired ack should be false")
	}
}

func TestRulesAckNoLongerHardGate(t *testing.T) {
	resetCallerStateForTest(CallerDefault)
	ctx := context.Background()
	if AgentRulesAcked(ctx) {
		t.Fatal("expect unacked")
	}
	r := NewRegistry(&Deps{})
	res := r.Invoke(ctx, workbench.CapListNotes, json.RawMessage(`{}`), nil)
	if strings.Contains(res.Error, "get_agent_rules") {
		t.Fatalf("must not gate on rules ack: %s", res.Error)
	}
}

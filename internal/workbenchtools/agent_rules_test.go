package workbenchtools

import (
	"context"
	"testing"
	"time"

	"WWorkbench/internal/workbench"
)

func TestGetAgentRulesAckAndGate(t *testing.T) {
	agentRulesAckUntilUnix.Store(0)
	if AgentRulesAcked() {
		t.Fatal("should start unacked")
	}
	if !requiresAgentRulesAck(workbench.CapShellRun) {
		t.Fatal("shell_run must require ack")
	}
	if requiresAgentRulesAck(workbench.CapGetAgentRules) {
		t.Fatal("get_agent_rules must not require ack")
	}

	res := toolGetAgentRules(context.Background(), nil, nil)
	if !res.OK {
		t.Fatalf("get_agent_rules failed: %s", res.Error)
	}
	if !AgentRulesAcked() {
		t.Fatal("should be acked after get_agent_rules")
	}

	agentRulesAckUntilUnix.Store(time.Now().Add(-time.Second).Unix())
	if AgentRulesAcked() {
		t.Fatal("expired ack should be false")
	}
}

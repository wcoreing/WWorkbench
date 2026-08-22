package agent

import (
	"strings"
	"testing"

	"WWorkbench/internal/agent/agentchoice"
)

func TestChoiceJSONRetryBroken(t *testing.T) {
	bad := "说明\n\n```agent-choice\n{\"n\":1,\"prompt\":\"?\",\"op\n```"
	retry, err := choiceJSONRetry(bad, 0, maxChoiceJSONRetries)
	if !retry || err == nil {
		t.Fatalf("want retry with error, got retry=%v err=%v", retry, err)
	}
}

func TestChoiceJSONRetryOK(t *testing.T) {
	ok := "```agent-choice\n{\"n\":1,\"mode\":\"single\",\"prompt\":\"?\",\"options\":[{\"key\":\"a\",\"label\":\"A\"}]}\n```"
	retry, err := choiceJSONRetry(ok, 0, maxChoiceJSONRetries)
	if retry || err != nil {
		t.Fatalf("want pass, got retry=%v err=%v", retry, err)
	}
}

func TestChoiceJSONRetryExhausted(t *testing.T) {
	bad := "```agent-choice\n{bad\n```"
	retry, err := choiceJSONRetry(bad, maxChoiceJSONRetries, maxChoiceJSONRetries)
	if retry || err == nil {
		t.Fatalf("want fail without retry, got retry=%v err=%v", retry, err)
	}
}

func TestChoiceJSONRetryUserMessage(t *testing.T) {
	bad := "```agent-choice\n{\"n\":1,\"op\n```"
	_, err := choiceJSONRetry(bad, 0, maxChoiceJSONRetries)
	msg := agentchoice.RetryUserMessage(err)
	if !strings.Contains(msg, "【系统】") || !strings.Contains(msg, "agent-choice") {
		t.Fatalf("msg=%q", msg)
	}
}

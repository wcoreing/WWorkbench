package agentchoice

import (
	"strings"
	"testing"
)

func TestValidateOK(t *testing.T) {
	content := "汇总\n\n```agent-choice\n{\"n\":1,\"mode\":\"single\",\"prompt\":\"下一步？\",\"options\":[{\"key\":\"a\",\"label\":\"A\"}]}\n```"
	if err := ValidateContent(content); err != nil {
		t.Fatal(err)
	}
}

func TestValidateBrokenJSON(t *testing.T) {
	content := "```desk-choice\n{\"n\":1,\"prompt\":\"下一步？\",\"op\n```"
	err := ValidateContent(content)
	if err == nil {
		t.Fatal("want error")
	}
	if !strings.Contains(err.Error(), "JSON") {
		t.Fatalf("got %v", err)
	}
}

func TestValidateNoOptions(t *testing.T) {
	content := "```agent-choice\n{\"n\":1,\"mode\":\"single\",\"prompt\":\"?\"}\n```"
	if err := ValidateContent(content); err == nil {
		t.Fatal("want schema error")
	}
}

func TestRetryUserMessage(t *testing.T) {
	msg := RetryUserMessage(ValidateContent("```agent-choice\n{bad\n```"))
	if !strings.Contains(msg, "【系统】") || !strings.Contains(msg, "agent-choice") {
		t.Fatalf("got %q", msg)
	}
}

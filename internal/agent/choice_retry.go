package agent

import "WWorkbench/internal/agent/agentchoice"

// choiceJSONRetry 终轮 assistant 含 agent-choice 且 JSON 无效时是否继续进模重写。
func choiceJSONRetry(content string, retries, maxRetries int) (retry bool, err error) {
	err = agentchoice.ValidateContent(content)
	if err == nil {
		return false, nil
	}
	if retries < maxRetries {
		return true, err
	}
	return false, err
}

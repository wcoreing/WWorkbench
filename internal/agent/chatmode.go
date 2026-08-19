package agent

import "strings"

const (
	ChatModeAsk   = "ask"
	ChatModeAgent = "agent"
	ChatModePlan  = "plan"
)

// NormalizeChatMode 归一化对话模式；未知则 Agent。
func NormalizeChatMode(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case ChatModeAsk:
		return ChatModeAsk
	case ChatModePlan:
		return ChatModePlan
	default:
		return ChatModeAgent
	}
}

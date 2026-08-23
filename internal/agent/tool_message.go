package agent

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"WWorkbench/internal/workbenchtools"
)

// 与 ningharness Gateway 本轮可见上限对齐：本轮工具正文直接进上下文。
const maxToolMsgRunes = 16000

// formatToolMessage 本轮工具结果进模正文（全文优先；仅超长才截断并附 resource 提示）。
func formatToolMessage(result workbenchtools.ToolResult, resourceID int64) string {
	body, err := json.Marshal(result)
	if err != nil {
		body = []byte(`{"ok":false,"error":"marshal tool result"}`)
	}
	text := string(body)
	n := utf8.RuneCountInString(text)
	if n <= maxToolMsgRunes {
		if resourceID > 0 {
			return text + fmt.Sprintf("\n〔resource#%d〕", resourceID)
		}
		return text
	}
	runes := []rune(text)
	head := string(runes[:maxToolMsgRunes])
	if resourceID > 0 {
		return fmt.Sprintf("%s\n…(已截断 %d 字，跨轮全文用 harness recall_resource resource_id=%d)", head, n, resourceID)
	}
	return fmt.Sprintf("%s\n…(已截断 %d 字)", head, n)
}

// meaningfulSummary 落盘/UI 用短摘要（禁止一律 "ok"）。
func meaningfulSummary(toolName string, result workbenchtools.ToolResult) string {
	if result.NeedsConfirm {
		if result.ConfirmSummary != "" {
			return result.ConfirmSummary
		}
		return toolName + " 待确认"
	}
	if result.NeedsChoice {
		if result.ConfirmSummary != "" {
			return result.ConfirmSummary
		}
		return toolName + " 待选择"
	}
	if !result.OK {
		if result.Error != "" {
			return result.Error
		}
		return toolName + " 失败"
	}
	n := utf8.RuneCountInString(string(result.Data))
	if n == 0 {
		return toolName + " ok"
	}
	if n <= 80 {
		return toolName + " · " + string(result.Data)
	}
	return fmt.Sprintf("%s · %d字", toolName, n)
}

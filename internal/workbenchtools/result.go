package workbenchtools

import "encoding/json"

// ToolResult 工具执行统一结果（Agent / 未来 MCP 共用）。
type ToolResult struct {
	OK             bool            `json:"ok"`
	Data           json.RawMessage `json:"data,omitempty"`
	Error          string          `json:"error,omitempty"`
	NeedsConfirm   bool            `json:"needsConfirm,omitempty"`
	PendingID      string          `json:"pendingId,omitempty"`
	ConfirmSummary string          `json:"confirmSummary,omitempty"`
}

// OKData 构造成功结果。
func OKData(v interface{}) ToolResult {
	b, _ := json.Marshal(v)
	return ToolResult{OK: true, Data: b}
}

// Fail 构造失败结果。
func Fail(msg string) ToolResult {
	return ToolResult{OK: false, Error: msg}
}

// Confirm 构造待确认结果。
func Confirm(pendingID, summary string, preview interface{}) ToolResult {
	b, _ := json.Marshal(preview)
	return ToolResult{
		OK:             true,
		NeedsConfirm:   true,
		PendingID:      pendingID,
		ConfirmSummary: summary,
		Data:           b,
	}
}

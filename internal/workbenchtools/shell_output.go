package workbenchtools

import (
	"context"
	"encoding/json"

	"WWorkbench/internal/terminal"
)

type getShellOutputArgs struct {
	SessionID       string `json:"sessionId"`
	HostID          string `json:"hostId"`
	Lines           int    `json:"lines"`
	OffsetFromEnd   int    `json:"offsetFromEnd"`
	TerminalSession string `json:"terminalSessionId"` // 与 get_workbench_context 字段对齐
}

// toolGetShellOutput 分页读取可见 PTY scrollback（按需拉取，非自动前馈）。
func toolGetShellOutput(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Terminals == nil {
		return Fail("终端服务不可用")
	}
	var in getShellOutputArgs
	_ = json.Unmarshal(raw, &in)
	sessionID := in.SessionID
	if sessionID == "" {
		sessionID = in.TerminalSession
	}
	lines := in.Lines
	if lines <= 0 {
		lines = terminal.ShellTailLines
	}
	meta, page, err := d.Terminals.GetShellOutput(sessionID, in.HostID, in.OffsetFromEnd, lines)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"sessionId":           meta.SessionID,
		"hostId":              meta.HostID,
		"title":               meta.Title,
		"kind":                meta.Kind,
		"updatedAt":           meta.UpdatedAt,
		"text":                page.Text,
		"totalLines":          page.TotalLines,
		"offsetFromEnd":       page.OffsetFromEnd,
		"returnedLines":       page.ReturnedLines,
		"hasMoreOlder":        page.HasMoreOlder,
		"nextOffsetFromEnd":   page.NextOffsetFrom,
	})
}

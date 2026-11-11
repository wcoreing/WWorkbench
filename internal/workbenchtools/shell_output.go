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
	WaitMs          int    `json:"waitMs"`           // >0 时阻塞等到新输出或超时
	AfterUpdatedAt  int64  `json:"afterUpdatedAt"`   // shell_run/上次返回的 updatedAt（毫秒）；已有更新则立刻返回
}

// toolGetShellOutput 分页读取可见 PTY scrollback（按需拉取；可 waitMs 少轮询）。
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

	timedOut := false
	waitedMs := 0
	if in.WaitMs > 0 {
		to, waited, err := d.Terminals.WaitShellOutput(ctx, sessionID, in.HostID, in.AfterUpdatedAt, in.WaitMs)
		if err != nil {
			return Fail(err.Error())
		}
		timedOut = to
		waitedMs = waited
	}

	meta, page, err := d.Terminals.GetShellOutput(sessionID, in.HostID, in.OffsetFromEnd, lines)
	if err != nil {
		return Fail(err.Error())
	}
	out := map[string]interface{}{
		"sessionId":         meta.SessionID,
		"hostId":            meta.HostID,
		"title":             meta.Title,
		"kind":              meta.Kind,
		"updatedAt":         meta.UpdatedAt,
		"text":              page.Text,
		"totalLines":        page.TotalLines,
		"offsetFromEnd":     page.OffsetFromEnd,
		"returnedLines":     page.ReturnedLines,
		"hasMoreOlder":      page.HasMoreOlder,
		"nextOffsetFromEnd": page.NextOffsetFrom,
	}
	if in.WaitMs > 0 {
		out["waitedMs"] = waitedMs
		out["timedOut"] = timedOut
	}
	return OKData(out)
}

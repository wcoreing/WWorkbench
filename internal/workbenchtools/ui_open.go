package workbenchtools

import (
	"context"
	"encoding/json"

	"WWorkbench/internal/workbench"
)

type databaseOpenArgs struct {
	ConnectionID   string                 `json:"connectionId"`
	InitialSQL     string                 `json:"initialSql"`
	RunSQL         *bool                  `json:"runSql"`
	ConnectionDraft map[string]interface{} `json:"connectionDraft"`
}

// toolTerminalOpen 打开终端（UI 联动 terminal_open）。
func toolTerminalOpen(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	return toolOpenTerminal(ctx, d, raw)
}

// toolDatabaseOpen 打开数据库工作台并可选填入 SQL（UI 联动 database_open）。
func toolDatabaseOpen(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in databaseOpenArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	runSql := true
	if in.RunSQL != nil {
		runSql = *in.RunSQL
	}
	payload := map[string]interface{}{
		"connectionId": in.ConnectionID,
		"initialSql":   in.InitialSQL,
		"runSql":       runSql,
	}
	if in.ConnectionDraft != nil {
		payload["connectionDraft"] = in.ConnectionDraft
	}
	d.UIActions.Dispatch(UIActionKind(workbench.CapDatabaseOpen), payload)
	return OKData(map[string]interface{}{
		"opened":       true,
		"connectionId": in.ConnectionID,
		"note":         "已切换到数据库工作台",
	})
}

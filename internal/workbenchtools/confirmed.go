package workbenchtools

import (
	"context"
	"encoding/json"

	"WWorkbench/internal/workbench"
)

// ExecuteConfirmed 用户（或外置 MCP 经工作台）确认后执行写工具。
func ExecuteConfirmed(ctx context.Context, d *Deps, toolName, argsJSON string) ToolResult {
	ensureSSHTerminalStage(d, toolName, json.RawMessage(argsJSON))
	switch toolName {
	case workbench.CapShellRun, "open_terminal", "terminal.open", "terminal_open":
		return ShellRunConfirmed(ctx, d, argsJSON)
	case "execute_sql":
		return ExecuteSQLConfirmed(ctx, d, argsJSON)
	case workbench.CapRunBackup:
		return RunBackupConfirmed(ctx, d, argsJSON)
	case "execute_http":
		return ExecuteHTTPConfirmed(ctx, d, argsJSON)
	case "start_container":
		return StartContainerConfirmed(ctx, d, argsJSON)
	case "stop_container":
		return StopContainerConfirmed(ctx, d, argsJSON)
	case "remove_container":
		return RemoveContainerConfirmed(ctx, d, argsJSON)
	case workbench.CapEditPluginPackFile:
		return EditPluginPackFileConfirmed(ctx, d, argsJSON)
	case workbench.CapWritePluginPackFile:
		return WritePluginPackFileConfirmed(ctx, d, argsJSON)
	case workbench.CapBuildPluginPackUI:
		return BuildPluginPackUIConfirmed(ctx, d, argsJSON)
	case workbench.CapRollbackPluginPack:
		return RollbackPluginPackConfirmed(ctx, d, argsJSON)
	default:
		return Fail("未知待确认工具: " + toolName)
	}
}

// AwaitConfirmAndExecute 外置 MCP：工作台拍板通过后执行；拒绝/超时返回错误结果。
func AwaitConfirmAndExecute(ctx context.Context, d *Deps, toolName string, args json.RawMessage, res ToolResult) ToolResult {
	if !res.NeedsConfirm {
		return res
	}
	if d == nil || d.MCPConfirm == nil {
		return Fail("工作台确认门未就绪，请在 App 内打开 WWorkbench 后重试")
	}
	// 弹确认前先亮对应 SSH 终端，确认与看过程同一视线
	ensureSSHTerminalStage(d, toolName, args)
	approved, err := d.MCPConfirm.Await(ctx, MCPConfirmRequest{
		PendingID: res.PendingID,
		ToolName:  toolName,
		Summary:   res.ConfirmSummary,
		Preview:   res.Data,
		Product:   ProductForTool(toolName),
	})
	if err != nil {
		return Fail(err.Error())
	}
	intent := extractIntent(args)
	MarkLatestIntentApproved(toolName, intent, approved)
	if !approved {
		return Fail("用户已在工作台拒绝：" + res.ConfirmSummary)
	}
	return ExecuteConfirmed(ctx, d, toolName, string(args))
}

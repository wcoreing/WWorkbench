package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WWorkbench/internal/store"
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
	case workbench.CapEnsureHostBackupPolicies:
		return EnsureHostBackupPoliciesConfirmed(ctx, d, argsJSON)
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
	case workbench.CapBrowserClick:
		return BrowserClickConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserKeys:
		return BrowserKeysConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserFill:
		return BrowserFillConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserUpload:
		return BrowserUploadConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserSelectOption:
		return BrowserSelectOptionConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserDrag:
		return BrowserDragConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserNavigate:
		return BrowserNavigateConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserOpenFrame:
		return BrowserOpenFrameConfirmed(ctx, d, argsJSON)
	case workbench.CapReplayTaskStep:
		return ReplayTaskStepConfirmed(ctx, d, argsJSON)
	case workbench.CapDistillWorkflow:
		return DistillWorkflowConfirmed(ctx, d, argsJSON)
	case workbench.CapSaveWorkflow:
		return SaveWorkflowConfirmed(ctx, d, argsJSON)
	case workbench.CapUpdateSkill:
		return UpdateSkillConfirmed(ctx, d, argsJSON)
	case workbench.CapRestoreDirVersion:
		return RestoreDirVersionConfirmed(ctx, d, argsJSON)
	case workbench.CapRestoreSkillVersion:
		return RestoreSkillVersionConfirmed(ctx, d, argsJSON)
	case workbench.CapRunSkill:
		return RunWorkflowConfirmed(ctx, d, argsJSON)
	default:
		return Fail("未知待确认工具: " + toolName)
	}
}

// browserStepConfirmTool 浏览器「执行过程」逐步类写工具（询问开关关闭时免弹窗）。
func browserStepConfirmTool(toolName string) bool {
	switch toolName {
	case workbench.CapBrowserClick, workbench.CapBrowserKeys, workbench.CapBrowserFill,
		workbench.CapBrowserUpload, workbench.CapBrowserSelectOption, workbench.CapBrowserDrag,
		workbench.CapBrowserNavigate, workbench.CapBrowserOpenFrame,
		workbench.CapReplayTaskStep, workbench.CapRunSkill:
		return true
	default:
		return false
	}
}

// browserAskConfirmEnabled 舞台「询问」开关；默认关闭（空值 / 0 / false）。
func browserAskConfirmEnabled(d *Deps) bool {
	if d == nil || d.Store == nil {
		return false
	}
	v, err := d.Store.GetAppSetting(store.SettingBrowserAskConfirm)
	if err != nil {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// AwaitConfirmAndExecute 外置 MCP：工作台拍板通过后执行；拒绝/超时返回错误结果。
// 浏览器逐步写操作：舞台「询问」默认关 → 免每步弹窗直接执行；打开后才阻塞确认。
func AwaitConfirmAndExecute(ctx context.Context, d *Deps, toolName string, args json.RawMessage, res ToolResult) ToolResult {
	if !res.NeedsConfirm {
		return res
	}
	ensureSSHTerminalStage(d, toolName, args)
	intent := extractIntent(args)

	if browserStepConfirmTool(toolName) && !browserAskConfirmEnabled(d) {
		MarkLatestIntentApproved(toolName, intent, true)
		return ExecuteConfirmed(ctx, d, toolName, string(args))
	}

	if d == nil || d.MCPConfirm == nil {
		return Fail("工作台确认门未就绪，请在 App 内打开 WWorkbench 后重试")
	}
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
	MarkLatestIntentApproved(toolName, intent, approved)
	if !approved {
		return Fail("用户已在工作台拒绝：" + res.ConfirmSummary)
	}
	return ExecuteConfirmed(ctx, d, toolName, string(args))
}

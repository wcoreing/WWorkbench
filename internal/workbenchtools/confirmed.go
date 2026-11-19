package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

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
	case workbench.CapSyncSSHSecurityGroup:
		return SyncSSHSecurityGroupConfirmed(ctx, d, argsJSON)
	case workbench.CapConfigureSSHSGSync:
		return ConfigureSSHSGSyncConfirmed(ctx, d, argsJSON)
	case workbench.CapConfigureNotify:
		return ExecuteConfigureNotify(d, argsJSON)
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
	case workbench.CapBrowserRun:
		return BrowserRunConfirmed(ctx, d, argsJSON)
	case workbench.CapBrowserOpenFrame:
		return BrowserOpenFrameConfirmed(ctx, d, argsJSON)
	case workbench.CapReplayTaskStep:
		return ReplayTaskStepConfirmed(ctx, d, argsJSON)
	case workbench.CapDistillSkill:
		return DistillSkillConfirmed(ctx, d, argsJSON)
	case workbench.CapUpdateSkill:
		return UpdateSkillConfirmed(ctx, d, argsJSON)
	case workbench.CapRestoreDirVersion:
		return RestoreDirVersionConfirmed(ctx, d, argsJSON)
	case workbench.CapRestoreSkillVersion:
		return RestoreSkillVersionConfirmed(ctx, d, argsJSON)
	case workbench.CapRunSkill:
		return RunWorkflowConfirmed(ctx, d, argsJSON)
	case workbench.CapDesktopAct:
		return DesktopActConfirmed(ctx, d, argsJSON)
	default:
		return Fail("未知待确认工具: " + toolName)
	}
}

// stepConfirmTool 「执行过程」逐步类写工具（浏览器 / 桌面；询问开关关闭时免弹窗）。
// 桌面操作的前提是该应用已获「操作」授权，授权本身不受此开关影响。
func stepConfirmTool(toolName string) bool {
	switch toolName {
	case workbench.CapBrowserClick, workbench.CapBrowserKeys, workbench.CapBrowserFill,
		workbench.CapBrowserUpload, workbench.CapBrowserSelectOption, workbench.CapBrowserDrag,
		workbench.CapBrowserNavigate, workbench.CapBrowserRun, workbench.CapBrowserOpenFrame,
		workbench.CapReplayTaskStep, workbench.CapRunSkill,
		workbench.CapDesktopAct:
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
// 浏览器 / 桌面逐步写操作：舞台「询问」默认关 → 免每步弹窗直接执行；打开后才阻塞确认。
func AwaitConfirmAndExecute(ctx context.Context, d *Deps, toolName string, args json.RawMessage, res ToolResult) ToolResult {
	if !res.NeedsConfirm {
		return res
	}
	started := time.Now()
	ensureSSHTerminalStage(d, toolName, args)
	intent := extractIntent(args)

	var out ToolResult
	defer func() {
		recordMCPCall(ctx, d, toolName, args, out, started)
	}()

	if stepConfirmTool(toolName) && !browserAskConfirmEnabled(d) {
		MarkLatestIntentApproved(ctx, toolName, intent, true)
		out = AttachTeachEnvelope(ctx, toolName, args, ExecuteConfirmed(ctx, d, toolName, string(args)))
		return out
	}

	if d == nil || d.MCPConfirm == nil {
		out = Fail("工作台确认门未就绪，请在 App 内打开 WWorkbench 后重试")
		return out
	}
	impact := confirmImpactHint(toolName, args)
	d.MCPConfirm.EmitStage("confirm", firstNonEmpty(res.ConfirmSummary, toolName), intent, impact, toolName)
	approved, err := d.MCPConfirm.Await(ctx, MCPConfirmRequest{
		PendingID: res.PendingID,
		ToolName:  toolName,
		Summary:   res.ConfirmSummary,
		Preview:   res.Data,
		Product:   ProductForTool(toolName),
	})
	if err != nil {
		d.MCPConfirm.EmitStage("shell", "确认超时或取消", intent, impact, toolName)
		out = AttachTeachEnvelope(ctx, toolName, args, Fail(err.Error()))
		return out
	}
	MarkLatestIntentApproved(ctx, toolName, intent, approved)
	if !approved {
		d.MCPConfirm.EmitStage("rejected", "已拒绝 · "+firstNonEmpty(res.ConfirmSummary, toolName), intent, impact, toolName)
		out = AttachTeachEnvelope(ctx, toolName, args, Fail("用户已在工作台拒绝："+res.ConfirmSummary))
		return out
	}
	d.MCPConfirm.EmitStage("done", "已确认 · "+firstNonEmpty(res.ConfirmSummary, toolName), intent, impact, toolName)
	out = AttachTeachEnvelope(ctx, toolName, args, ExecuteConfirmed(ctx, d, toolName, string(args)))
	return out
}

// confirmImpactHint 从工具名与参数抽出确认弹窗用的影响面短句。
func confirmImpactHint(toolName string, args json.RawMessage) string {
	var m map[string]interface{}
	_ = json.Unmarshal(args, &m)
	pick := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := m[k]; ok {
				s := strings.TrimSpace(fmtString(v))
				if s != "" {
					return truncateRunes(s, 56)
				}
			}
		}
		return ""
	}
	switch {
	case strings.Contains(toolName, "security_group"), toolName == workbench.CapSyncSSHSecurityGroup:
		if h := pick("hostOrName", "sshHostId", "hostId"); h != "" {
			return "安全组 · " + h
		}
		return "安全组入站规则"
	case toolName == "execute_sql":
		if db := pick("database", "connectionId"); db != "" {
			return "数据库 · " + db
		}
		return "数据库写操作"
	case toolName == "shell_run", toolName == "open_terminal":
		if v, ok := m["localShell"]; ok {
			switch x := v.(type) {
			case bool:
				if x {
					return "本机终端"
				}
			case string:
				if strings.EqualFold(strings.TrimSpace(x), "true") {
					return "本机终端"
				}
			}
		}
		if h := pick("hostOrName", "name", "hostId"); h != "" {
			return "SSH · " + h
		}
		return "远程终端"
	case strings.Contains(toolName, "container"):
		if c := pick("containerId", "name"); c != "" {
			return "容器 · " + c
		}
		return "容器生命周期"
	case toolName == workbench.CapRunBackup, strings.Contains(toolName, "backup"):
		if p := pick("path", "policyId"); p != "" {
			return "备份 · " + p
		}
		return "备份写操作"
	default:
		if p := pick("path", "url", "packId"); p != "" {
			return p
		}
		return toolName
	}
}


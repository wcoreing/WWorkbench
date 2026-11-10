package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/model"

	"github.com/google/uuid"
)

type openTerminalArgs struct {
	LocalShell     bool   `json:"localShell"`
	HostID         string `json:"hostId"`
	HostOrName     string `json:"hostOrName"`
	InitialCommand string `json:"initialCommand"`
	Intent         string `json:"intent"`
}

// normalizeTerminalCommand 将多行命令规范为可写入 PTY 的格式（每行以 \r 结尾）。
// 保留行首缩进与空行：Python / heredoc 依赖空白；禁止 TrimSpace 每一行。
func normalizeTerminalCommand(cmd string) string {
	if strings.TrimSpace(cmd) == "" {
		return ""
	}
	raw := strings.ReplaceAll(cmd, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	raw = strings.Trim(raw, "\n")
	lines := strings.Split(raw, "\n")
	var b strings.Builder
	for _, line := range lines {
		b.WriteString(line)
		b.WriteByte('\r')
	}
	return b.String()
}

// resolveSSHHost 按 id、IP/主机名或显示名称匹配 SSH 配置。
func resolveSSHHost(d *Deps, hostID, hostOrName string) (*model.SSHHostDO, []model.SSHHostDO, string) {
	hostID = strings.TrimSpace(hostID)
	hostOrName = strings.TrimSpace(hostOrName)
	if hostID != "" {
		h, err := d.SSHHosts.Get(hostID)
		if err != nil {
			return nil, nil, err.Error()
		}
		return h, nil, ""
	}
	key := hostOrName
	if key == "" {
		return nil, nil, "请提供 hostId 或 hostOrName（IP、主机名或配置名称）"
	}
	list, err := d.SSHHosts.List()
	if err != nil {
		return nil, nil, err.Error()
	}
	var matches []model.SSHHostDO
	for i := range list {
		h := list[i]
		if h.ID == key || strings.EqualFold(h.Host, key) || strings.EqualFold(h.Name, key) {
			matches = append(matches, h)
		}
	}
	switch len(matches) {
	case 0:
		return nil, nil, "未找到匹配的 SSH 主机: " + key + "，请先 list_ssh_hosts"
	case 1:
		return &matches[0], nil, ""
	default:
		return nil, matches, "匹配到多个 SSH 主机，请指定 hostId"
	}
}

// toolOpenTerminal 打开终端并可选注入命令（UI 联动 shell_run）。
// 风险命令（重定向写文件 / rm / docker rm 等）先返回 Confirm，外置 MCP 在工作台拍板后再注入。
func toolOpenTerminal(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in openTerminalArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if risky, reason := assessShellRisk(in.InitialCommand); risky {
		hostKey := "local"
		if !in.LocalShell {
			if h, _, errMsg := resolveSSHHost(d, in.HostID, in.HostOrName); errMsg == "" && h != nil {
				hostKey = h.ID
			}
		}
		if d.WriteAllows != nil && d.WriteAllows.WaiveSoftFileRisk(hostKey, in.InitialCommand, reason) {
			return dispatchShellRun(d, in)
		}
		preview, errMsg := shellRunConfirmPreview(d, in)
		if errMsg != "" {
			return Fail(errMsg)
		}
		preview["risk"] = reason
		preview["command"] = strings.TrimSpace(in.InitialCommand)
		if intent := strings.TrimSpace(in.Intent); intent != "" {
			preview["intent"] = intent
		}
		if isHardShellRiskReason(reason) {
			preview["dataGuard"] = true
			preview["backupDir"] = defaultDataBackupRoot
			if reason == riskSyncNoDataExclude || (isRsyncCmd(in.InitialCommand) && !hasDataExcludes(in.InitialCommand)) {
				preview["autoExclude"] = "*.db / data / .env"
			}
			if shouldApplyDataGuardOnConfirm(reason) {
				preview["backupBefore"] = true
			}
		}
		summary := "终端注入：" + reason
		if intent := strings.TrimSpace(in.Intent); intent != "" {
			summary = truncateRunes(intent, intentTitleMaxRune)
		}
		return Confirm(uuid.NewString(), summary, preview)
	}
	return dispatchShellRun(d, in)
}

// ShellRunConfirmed 用户确认后注入 shell_run（跳过风险检查；数据防护仍自动 exclude + 写前备份）。
func ShellRunConfirmed(_ context.Context, d *Deps, argsJSON string) ToolResult {
	var in openTerminalArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	hostKey := "local"
	if !in.LocalShell {
		if h, _, errMsg := resolveSSHHost(d, in.HostID, in.HostOrName); errMsg == "" && h != nil {
			hostKey = h.ID
		}
	}
	in.InitialCommand, _ = applyDataGuardOnConfirm(d, hostKey, in.InitialCommand)
	return dispatchShellRun(d, in)
}

func shellRunConfirmPreview(d *Deps, in openTerminalArgs) (map[string]interface{}, string) {
	preview := map[string]interface{}{
		"localShell":     in.LocalShell,
		"initialCommand": strings.TrimSpace(in.InitialCommand),
		"commandPreview": truncateCmdPreview(in.InitialCommand, 120),
	}
	if intent := strings.TrimSpace(in.Intent); intent != "" {
		preview["intent"] = intent
	}
	if in.LocalShell {
		preview["name"] = "本机"
		preview["kind"] = "local"
		return preview, ""
	}
	host, ambiguous, errMsg := resolveSSHHost(d, in.HostID, in.HostOrName)
	if errMsg != "" {
		if len(ambiguous) > 0 {
			parts := make([]string, 0, len(ambiguous))
			for _, h := range ambiguous {
				parts = append(parts, fmt.Sprintf("%s %s@%s (id=%s)", h.Name, h.User, h.Host, h.ID))
			}
			return nil, errMsg + "：" + strings.Join(parts, "；")
		}
		return nil, errMsg
	}
	preview["hostId"] = host.ID
	preview["name"] = host.Name
	preview["host"] = host.Host
	preview["user"] = host.User
	preview["kind"] = "ssh"
	return preview, ""
}

func stagePreviewWithIntent(intent, cmdPreview string) string {
	intent = strings.TrimSpace(intent)
	if intent != "" {
		return truncateRunes(intent, 48)
	}
	return cmdPreview
}

func dispatchShellRun(d *Deps, in openTerminalArgs) ToolResult {
	cmd := normalizeTerminalCommand(in.InitialCommand)
	if in.LocalShell {
		if d.UIActions == nil {
			return Fail("UI 联动未初始化")
		}
		preview := truncateCmdPreview(in.InitialCommand, 72)
		stagePrev := stagePreviewWithIntent(in.Intent, preview)
		payload := map[string]interface{}{
			"localShell":     true,
			"initialCommand": cmd,
			"name":           "本机",
			"stageLabel":     stageLabelLocal(stagePrev),
			"commandPreview": preview,
		}
		if intent := strings.TrimSpace(in.Intent); intent != "" {
			payload["intent"] = intent
		}
		d.UIActions.Dispatch(UIActionShellRun, payload)
		return OKData(map[string]interface{}{
			"opened":         true,
			"kind":           "local",
			"initialCommand": cmd,
			"note":           "已切换到本机终端；命令将自动输入，请在终端面板查看输出。随后用 get_shell_output(waitMs) 等新输出。",
		})
	}
	host, ambiguous, errMsg := resolveSSHHost(d, in.HostID, in.HostOrName)
	if errMsg != "" {
		if len(ambiguous) > 0 {
			parts := make([]string, 0, len(ambiguous))
			for _, h := range ambiguous {
				parts = append(parts, fmt.Sprintf("%s %s@%s (id=%s)", h.Name, h.User, h.Host, h.ID))
			}
			return Fail(errMsg + "：" + strings.Join(parts, "；"))
		}
		return Fail(errMsg)
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	preview := truncateCmdPreview(in.InitialCommand, 72)
	stagePrev := stagePreviewWithIntent(in.Intent, preview)
	payload := map[string]interface{}{
		"hostId":         host.ID,
		"initialCommand": cmd,
		"name":           host.Name,
		"host":           host.Host,
		"user":           host.User,
		"stageLabel":     stageLabelSSH(host.Name, stagePrev),
		"commandPreview": preview,
	}
	if intent := strings.TrimSpace(in.Intent); intent != "" {
		payload["intent"] = intent
	}
	d.UIActions.Dispatch(UIActionShellRun, payload)
	return OKData(map[string]interface{}{
		"opened":         true,
		"hostId":         host.ID,
		"name":           host.Name,
		"host":           host.Host,
		"user":           host.User,
		"initialCommand": cmd,
		"note":           "已切换到 SSH 终端；命令将自动输入，请在终端面板查看输出。随后用 get_shell_output(waitMs) 等新输出。",
	})
}

func truncateCmdPreview(cmd string, max int) string {
	s := strings.TrimSpace(strings.ReplaceAll(cmd, "\r", " "))
	s = strings.ReplaceAll(s, "\n", " · ")
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func stageLabelLocal(preview string) string {
	if preview == "" {
		return "MCP · 本机终端"
	}
	return "MCP · 本机 · " + preview
}

func stageLabelSSH(name, preview string) string {
	label := strings.TrimSpace(name)
	if label == "" {
		label = "SSH"
	}
	if preview == "" {
		return "MCP · " + label
	}
	return "MCP · " + label + " · " + preview
}

// stageSSHHost 打开/聚焦指定 SSH 主机的可见终端（不注入命令）。
func stageSSHHost(d *Deps, host *model.SSHHostDO, action string) {
	if d == nil || d.UIActions == nil || host == nil {
		return
	}
	preview := strings.TrimSpace(action)
	d.UIActions.Dispatch(UIActionShellRun, map[string]interface{}{
		"hostId":         host.ID,
		"name":           host.Name,
		"host":           host.Host,
		"user":           host.User,
		"stageLabel":     stageLabelSSH(host.Name, preview),
		"commandPreview": preview,
	})
}

type terminalReconnectArgs struct {
	SessionID         string `json:"sessionId"`
	TerminalSessionID string `json:"terminalSessionId"`
	HostID            string `json:"hostId"`
	HostOrName        string `json:"hostOrName"`
	LocalShell        bool   `json:"localShell"`
}

// toolTerminalReconnect 重连可见终端（UI 联动 terminal_reconnect）。
func toolTerminalReconnect(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in terminalReconnectArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	sessionID := strings.TrimSpace(in.SessionID)
	if sessionID == "" {
		sessionID = strings.TrimSpace(in.TerminalSessionID)
	}
	hostID := strings.TrimSpace(in.HostID)
	hostOrName := strings.TrimSpace(in.HostOrName)
	if !in.LocalShell && sessionID == "" && hostID == "" && hostOrName == "" {
		return Fail("请提供 sessionId、hostId/hostOrName 或 localShell=true")
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}

	payload := map[string]interface{}{}
	if sessionID != "" {
		payload["sessionId"] = sessionID
	}
	if in.LocalShell {
		payload["localShell"] = true
		d.UIActions.Dispatch(UIActionTerminalReconnect, payload)
		return OKData(map[string]interface{}{
			"reconnecting": true,
			"kind":         "local",
			"note":         "已请求重连本机终端；面板会保留历史输出",
		})
	}
	if hostID == "" && hostOrName != "" {
		host, ambiguous, errMsg := resolveSSHHost(d, "", hostOrName)
		if errMsg != "" {
			if len(ambiguous) > 0 {
				parts := make([]string, 0, len(ambiguous))
				for _, h := range ambiguous {
					parts = append(parts, fmt.Sprintf("%s %s@%s (id=%s)", h.Name, h.User, h.Host, h.ID))
				}
				return Fail(errMsg + "：" + strings.Join(parts, "；"))
			}
			return Fail(errMsg)
		}
		hostID = host.ID
		payload["hostId"] = host.ID
		d.UIActions.Dispatch(UIActionTerminalReconnect, payload)
		return OKData(map[string]interface{}{
			"reconnecting": true,
			"hostId":       host.ID,
			"name":         host.Name,
			"host":         host.Host,
			"user":         host.User,
			"note":         "已请求重连 SSH 终端；面板会保留历史输出",
		})
	}
	if hostID != "" {
		payload["hostId"] = hostID
	}
	d.UIActions.Dispatch(UIActionTerminalReconnect, payload)
	out := map[string]interface{}{
		"reconnecting": true,
		"note":         "已请求重连终端；面板会保留历史输出。若尚无标签将新开连接",
	}
	if sessionID != "" {
		out["sessionId"] = sessionID
	}
	if hostID != "" {
		out["hostId"] = hostID
	}
	return OKData(out)
}

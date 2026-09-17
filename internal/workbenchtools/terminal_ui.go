package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"WWorkbench/internal/model"
)

type openTerminalArgs struct {
	LocalShell      bool   `json:"localShell"`
	HostID          string `json:"hostId"`
	HostOrName      string `json:"hostOrName"`
	InitialCommand  string `json:"initialCommand"`
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
func toolOpenTerminal(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in openTerminalArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	cmd := normalizeTerminalCommand(in.InitialCommand)
	if in.LocalShell {
		if d.UIActions == nil {
			return Fail("UI 联动未初始化")
		}
		d.UIActions.Dispatch(UIActionShellRun, map[string]interface{}{
			"localShell":     true,
			"initialCommand": cmd,
		})
		return OKData(map[string]interface{}{
			"opened":         true,
			"kind":           "local",
			"initialCommand": cmd,
			"note":           "已切换到本机终端；命令将自动输入，请在终端面板查看输出",
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
	d.UIActions.Dispatch(UIActionShellRun, map[string]interface{}{
		"hostId":         host.ID,
		"initialCommand": cmd,
	})
	return OKData(map[string]interface{}{
		"opened":         true,
		"hostId":         host.ID,
		"name":           host.Name,
		"host":           host.Host,
		"user":           host.User,
		"initialCommand": cmd,
		"note":           "已切换到 SSH 终端；命令将自动输入，请在终端面板查看输出",
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

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
func normalizeTerminalCommand(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return ""
	}
	raw := strings.ReplaceAll(cmd, "\r\n", "\n")
	lines := strings.Split(raw, "\n")
	var parts []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !strings.HasSuffix(line, "\r") {
			line += "\r"
		}
		parts = append(parts, line)
	}
	return strings.Join(parts, "")
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

// toolOpenTerminal 打开终端并可选注入命令（UI 联动 terminal.open）。
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
		d.UIActions.Dispatch(UIActionTerminalOpen, map[string]interface{}{
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
	d.UIActions.Dispatch(UIActionTerminalOpen, map[string]interface{}{
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

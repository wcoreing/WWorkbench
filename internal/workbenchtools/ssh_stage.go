package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	dockersvc "WWorkbench/internal/docker"
)

// ensureSSHTerminalStage 凡工具参数能解析到 SSH 主机，先打开并聚焦对应可见终端。
// 挂在 Registry.Invoke / 确认执行入口，覆盖 shell、Docker 远端、日志源、库连接隧道等，避免按工具零散补丁。
func ensureSSHTerminalStage(d *Deps, toolName string, raw json.RawMessage) {
	if d == nil || d.UIActions == nil || len(raw) == 0 {
		return
	}
	var in struct {
		HostID       string `json:"hostId"`
		SSHHostID    string `json:"sshHostId"`
		HostOrName   string `json:"hostOrName"`
		ContextID    string `json:"contextId"`
		LogSourceID  string `json:"logSourceId"`
		ConnectionID string `json:"connectionId"`
		LocalShell   bool   `json:"localShell"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return
	}
	if in.LocalShell {
		return
	}
	action := shortSSHStageAction(toolName)

	if id := strings.TrimSpace(in.HostID); id != "" {
		stageSSHByID(d, id, action)
		return
	}
	if id := strings.TrimSpace(in.SSHHostID); id != "" {
		stageSSHByID(d, id, action)
		return
	}
	if name := strings.TrimSpace(in.HostOrName); name != "" {
		if h, _, errMsg := resolveSSHHost(d, "", name); errMsg == "" && h != nil {
			stageSSHHost(d, h, action)
		}
		return
	}
	if ctxID := strings.TrimSpace(in.ContextID); ctxID != "" && ctxID != dockersvc.LocalContextID {
		stageDockerSSHOnly(d, ctxID, action)
		return
	}
	if logID := strings.TrimSpace(in.LogSourceID); logID != "" && d.Store != nil {
		if src, err := d.Store.GetLogSource(logID); err == nil && src != nil {
			if id := strings.TrimSpace(src.SSHHostID); id != "" {
				stageSSHByID(d, id, action)
				return
			}
			if ctxID := strings.TrimSpace(src.DockerContextID); ctxID != "" && ctxID != dockersvc.LocalContextID {
				stageDockerSSHOnly(d, ctxID, action)
			}
		}
		return
	}
	if connID := strings.TrimSpace(in.ConnectionID); connID != "" && d.Conns != nil {
		if c, err := d.Conns.Get(connID); err == nil && c != nil && c.SSHEnabled {
			if id := strings.TrimSpace(c.SSHHostID); id != "" {
				stageSSHByID(d, id, action)
			}
		}
	}
}

func shortSSHStageAction(toolName string) string {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return "SSH"
	}
	return name
}

// stageSSHByID 按主机 ID 打开/聚焦可见终端。
func stageSSHByID(d *Deps, hostID, action string) {
	hostID = strings.TrimSpace(hostID)
	if d == nil || d.UIActions == nil || hostID == "" {
		return
	}
	if d.SSHHosts != nil {
		if h, err := d.SSHHosts.Get(hostID); err == nil && h != nil {
			stageSSHHost(d, h, action)
			return
		}
	}
	d.UIActions.Dispatch(UIActionShellRun, map[string]interface{}{
		"hostId":         hostID,
		"stageLabel":     stageLabelSSH(hostID, action),
		"commandPreview": strings.TrimSpace(action),
	})
}

// stageDockerSSHOnly 仅当 Docker 上下文挂了 SSH 时亮终端（本机 Docker 不抢终端）。
func stageDockerSSHOnly(d *Deps, contextID, action string) {
	if d == nil || d.Docker == nil {
		return
	}
	list, err := d.Docker.ListContexts(context.Background())
	if err != nil {
		return
	}
	for _, c := range list {
		if c.ID != contextID {
			continue
		}
		if id := strings.TrimSpace(c.SSHHostID); id != "" {
			label := action
			if n := strings.TrimSpace(c.Name); n != "" && action != "" {
				label = n + " · " + action
			} else if n := strings.TrimSpace(c.Name); n != "" {
				label = n
			}
			stageSSHByID(d, id, label)
		}
		return
	}
}

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

// toolTerminalOpen 打开终端（UI 联动 shell_run）。
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

type logsOpenArgs struct {
	LogSourceID     string `json:"logSourceId"`
	SourceType      string `json:"sourceType"`
	Name            string `json:"name"`
	Path            string `json:"path"`
	SSHHostID       string `json:"sshHostId"`
	DockerContextID string `json:"dockerContextId"`
	ContainerID     string `json:"containerId"`
	ComposeDir      string `json:"composeDir"`
	ComposeService  string `json:"composeService"`
	Fetch           *bool  `json:"fetch"`
}

// toolLogsOpen 打开日志中心（UI 联动 logs_open）。
func toolLogsOpen(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in logsOpenArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	fetch := true
	if in.Fetch != nil {
		fetch = *in.Fetch
	}
	d.UIActions.Dispatch(UIActionLogsOpen, map[string]interface{}{
		"logSourceId":     in.LogSourceID,
		"sourceType":      in.SourceType,
		"name":            in.Name,
		"path":            in.Path,
		"sshHostId":       in.SSHHostID,
		"dockerContextId": in.DockerContextID,
		"containerId":     in.ContainerID,
		"composeDir":      in.ComposeDir,
		"composeService":  in.ComposeService,
		"fetch":           fetch,
	})
	return OKData(map[string]interface{}{
		"opened":      true,
		"logSourceId": in.LogSourceID,
		"note":        "已切换到日志中心",
	})
}

type httpAPIOpenArgs struct {
	RequestID string `json:"requestId"`
}

// toolHTTPAPIOpen 打开 HTTP API 工作台（UI 联动 httpapi_open）。
func toolHTTPAPIOpen(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in httpAPIOpenArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	d.UIActions.Dispatch(UIActionHTTPAPIOpen, map[string]interface{}{
		"requestId": in.RequestID,
	})
	return OKData(map[string]interface{}{
		"opened":    true,
		"requestId": in.RequestID,
		"note":      "已切换到 API 工作台",
	})
}

type environmentOpenArgs struct {
	Lang         string `json:"lang"`
	PresetID     string `json:"presetId"`
	OpenVersions *bool  `json:"openVersions"`
}

// toolEnvironmentOpen 打开本机环境工作台（UI 联动 environment_open）。
func toolEnvironmentOpen(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in environmentOpenArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	openVersions := in.Lang != ""
	if in.OpenVersions != nil {
		openVersions = *in.OpenVersions
	}
	d.UIActions.Dispatch(UIActionEnvironmentOpen, map[string]interface{}{
		"lang":         in.Lang,
		"presetId":     in.PresetID,
		"openVersions": openVersions,
	})
	return OKData(map[string]interface{}{
		"opened": true,
		"lang":   in.Lang,
		"note":   "已切换到环境工作台",
	})
}

type sshForwardOpenArgs struct {
	HostID   string `json:"hostId"`
	PresetID string `json:"presetId"`
	OpenNew  *bool  `json:"openNew"`
}

// toolSSHForwardOpen 打开 SSH 隧道面板（UI 联动 ssh_forward_open）。
func toolSSHForwardOpen(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in sshForwardOpenArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效: " + err.Error())
	}
	if d.UIActions == nil {
		return Fail("UI 联动未初始化")
	}
	openNew := in.HostID != ""
	if in.OpenNew != nil {
		openNew = *in.OpenNew
	}
	d.UIActions.Dispatch(UIActionSSHForwardOpen, map[string]interface{}{
		"hostId":   in.HostID,
		"presetId": in.PresetID,
		"openNew":  openNew,
	})
	return OKData(map[string]interface{}{
		"opened":   true,
		"hostId":   in.HostID,
		"presetId": in.PresetID,
		"note":     "已切换到终端并打开 SSH 隧道",
	})
}

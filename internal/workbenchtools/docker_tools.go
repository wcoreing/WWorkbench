package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	dockersvc "WWorkbench/internal/docker"
	"WWorkbench/internal/workbench"

	"github.com/google/uuid"
)

type listContainersArgs struct {
	ContextID string `json:"contextId"`
}

type containerLogsArgs struct {
	ContextID   string `json:"contextId"`
	ContainerID string `json:"containerId"`
	Tail        int    `json:"tail"`
}

type containerMutateArgs struct {
	ContextID   string `json:"contextId"`
	ContainerID string `json:"containerId"`
}

const maxDockerLogTail = 500

// toolListDockerContexts 列出 Docker 上下文（含本地）。
func toolListDockerContexts(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	list, err := d.Docker.ListContexts(ctx)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(list)
}

// toolListContainers 列出指定上下文下的容器（只读）。
func toolListContainers(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	var in listContainersArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	ctxID := strings.TrimSpace(in.ContextID)
	if ctxID == "" {
		ctxID = dockersvc.LocalContextID
	}
	list, err := d.Docker.ListContainers(ctx, ctxID)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{
		"contextId":  ctxID,
		"containers": list,
	})
}

// toolGetContainerLogs 获取容器日志尾部（只读）。
func toolGetContainerLogs(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	var in containerLogsArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	ctxID := strings.TrimSpace(in.ContextID)
	if ctxID == "" {
		ctxID = dockersvc.LocalContextID
	}
	cid := strings.TrimSpace(in.ContainerID)
	if cid == "" {
		return Fail("请填写 containerId")
	}
	tail := in.Tail
	if tail <= 0 {
		tail = 200
	}
	if tail > maxDockerLogTail {
		tail = maxDockerLogTail
	}
	text, err := d.Docker.GetContainerLogs(ctx, ctxID, cid, tail)
	if err != nil {
		return Fail(err.Error())
	}
	if len(text) > 12000 {
		text = text[len(text)-12000:]
		text = "…(已截断)\n" + text
	}
	return OKData(map[string]interface{}{
		"contextId": ctxID, "containerId": cid, "tail": tail, "content": text,
	})
}

func parseContainerMutateArgs(raw json.RawMessage) (ctxID, cid string, errMsg string) {
	var in containerMutateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", "", "参数无效"
	}
	ctxID = strings.TrimSpace(in.ContextID)
	if ctxID == "" {
		ctxID = dockersvc.LocalContextID
	}
	cid = strings.TrimSpace(in.ContainerID)
	if cid == "" {
		return "", "", "请填写 containerId（名称或 ID，可用 list_containers 获取）"
	}
	return ctxID, cid, ""
}

// toolStartContainer 启动容器（需用户确认）。
func toolStartContainer(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	ctxID, cid, errMsg := parseContainerMutateArgs(raw)
	if errMsg != "" {
		return Fail(errMsg)
	}
	cmd := "docker start " + cid
	return Confirm(uuid.NewString(), "启动容器 "+cid, map[string]interface{}{
		"action": "start", "contextId": ctxID, "containerId": cid, "command": cmd,
	})
}

// toolStopContainer 停止容器（需用户确认）。
func toolStopContainer(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	ctxID, cid, errMsg := parseContainerMutateArgs(raw)
	if errMsg != "" {
		return Fail(errMsg)
	}
	cmd := "docker stop " + cid
	return Confirm(uuid.NewString(), "停止容器 "+cid, map[string]interface{}{
		"action": "stop", "contextId": ctxID, "containerId": cid, "command": cmd,
	})
}

// toolRemoveContainer 删除容器（需用户确认；force）。
func toolRemoveContainer(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	ctxID, cid, errMsg := parseContainerMutateArgs(raw)
	if errMsg != "" {
		return Fail(errMsg)
	}
	cmd := "docker rm -f " + cid
	return Confirm(uuid.NewString(), "删除容器 "+cid, map[string]interface{}{
		"action": "remove", "contextId": ctxID, "containerId": cid, "command": cmd,
	})
}

// StartContainerConfirmed 用户确认后启动容器。
func StartContainerConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	return runContainerMutate(ctx, d, argsJSON, "start")
}

// StopContainerConfirmed 用户确认后停止容器。
func StopContainerConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	return runContainerMutate(ctx, d, argsJSON, "stop")
}

// RemoveContainerConfirmed 用户确认后删除容器。
func RemoveContainerConfirmed(ctx context.Context, d *Deps, argsJSON string) ToolResult {
	return runContainerMutate(ctx, d, argsJSON, "remove")
}

func runContainerMutate(ctx context.Context, d *Deps, argsJSON, action string) ToolResult {
	if d.Docker == nil {
		return Fail("Docker 服务未就绪")
	}
	ctxID, cid, errMsg := parseContainerMutateArgs(json.RawMessage(argsJSON))
	if errMsg != "" {
		return Fail(errMsg)
	}
	var err error
	switch action {
	case "start":
		err = d.Docker.StartContainer(ctx, ctxID, cid)
	case "stop":
		err = d.Docker.StopContainer(ctx, ctxID, cid)
	case "remove":
		err = d.Docker.RemoveContainer(ctx, ctxID, cid)
	default:
		return Fail("未知容器操作: " + action)
	}
	if err != nil {
		return Fail(err.Error())
	}
	op := workbench.RadarOpUpdate
	if action == "remove" {
		op = workbench.RadarOpDelete
	}
	if d.Radar != nil {
		d.Radar.EmitDockerContainer(op, ctxID, cid, "agent-docker-"+action, action+" "+cid, true)
	}
	return OKData(map[string]interface{}{
		"ok": true, "action": action, "contextId": ctxID, "containerId": cid,
	})
}

package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	dockersvc "WNavicat/internal/docker"
)

type listContainersArgs struct {
	ContextID string `json:"contextId"`
}

type containerLogsArgs struct {
	ContextID   string `json:"contextId"`
	ContainerID string `json:"containerId"`
	Tail        int    `json:"tail"`
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

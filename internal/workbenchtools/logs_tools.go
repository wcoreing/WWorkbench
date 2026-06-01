package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"

	"WNavicat/internal/logs"
)

type fetchLogsArgs struct {
	LogSourceID string `json:"logSourceId"`
	Tail        int    `json:"tail"`
}

const maxLogFetchTail = 500

// toolListLogSources 列出已保存日志源（不含敏感路径以外的密钥）。
func toolListLogSources(ctx context.Context, d *Deps, _ json.RawMessage) ToolResult {
	list, err := d.Store.ListLogSources()
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(list)
}

// toolFetchLogs 拉取日志尾部（只读）。
func toolFetchLogs(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	if d.Docker == nil {
		return Fail("日志服务未就绪")
	}
	var in fetchLogsArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return Fail("参数无效")
	}
	id := strings.TrimSpace(in.LogSourceID)
	if id == "" {
		return Fail("请填写 logSourceId")
	}
	src, err := d.Store.GetLogSource(id)
	if err != nil {
		return Fail(err.Error())
	}
	tail := in.Tail
	if tail <= 0 {
		tail = src.TailLines
	}
	if tail <= 0 {
		tail = 200
	}
	if tail > maxLogFetchTail {
		tail = maxLogFetchTail
	}
	text, err := logs.Fetch(ctx, *src, d.SSHHosts, d.Docker, tail)
	if err != nil {
		return Fail(err.Error())
	}
	if len(text) > 12000 {
		text = text[len(text)-12000:]
		text = "…(已截断)\n" + text
	}
	return OKData(map[string]interface{}{
		"logSourceId": id,
		"name":        src.Name,
		"sourceType":  src.SourceType,
		"tail":        tail,
		"content":     text,
	})
}

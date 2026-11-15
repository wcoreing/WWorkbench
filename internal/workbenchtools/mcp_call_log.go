package workbenchtools

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"WWorkbench/internal/model"
	"WWorkbench/internal/workbench"
)

// skipMCPCallLog 不记账的工具（避免自引用噪声）。
func skipMCPCallLog(tool string) bool {
	switch tool {
	case workbench.CapListMCPLogs, workbench.CapGetMCPLog,
		workbench.CapGetAgentRules, "get_workbench_context":
		return true
	default:
		return false
	}
}

// recordMCPCall 在工具终态结果上记账（非 NeedsConfirm 等待态）。
func recordMCPCall(ctx context.Context, d *Deps, tool string, args json.RawMessage, res ToolResult, started time.Time) {
	if d == nil || d.Store == nil || skipMCPCallLog(tool) {
		return
	}
	if res.NeedsConfirm {
		return
	}
	dur := time.Since(started).Milliseconds()
	if dur < 0 {
		dur = 0
	}
	refs := enrichMCPResourceLabels(d, extractMCPResources(tool, args))
	intent := extractIntent(args)
	ok := res.OK && !res.NeedsChoice
	errMsg := res.Error
	if res.NeedsChoice {
		errMsg = ""
		ok = true
	}
	row := model.MCPCallLogDO{
		At:          time.Now().UnixMilli(),
		Caller:      CallerID(ctx),
		Tool:        tool,
		Intent:      intent,
		OK:          ok,
		Error:       errMsg,
		DurationMs:  dur,
		Resources:   refs,
		ArgsSummary: mcpArgsSummary(args),
		TaskSession: CurrentTaskSession(ctx),
	}
	saved, err := d.Store.AppendMCPCallLog(row)
	if err != nil {
		return
	}
	if d.Radar != nil {
		label := tool
		if intent != "" {
			label = tool + " · " + intent
		}
		d.Radar.EmitMCPCall(workbench.RadarOpCreate, saved.ID, "mcp-call", label, false)
	}
}

// groupMCPLogsByIntent 按意图聚合（同 intent 相邻合并；空意图各自独立）。
func groupMCPLogsByIntent(logs []model.MCPCallLogDO) []map[string]interface{} {
	type bucket struct {
		Intent    string
		Count     int
		Tools     []string
		Resources []model.MCPAssetRef
		LogIDs    []string
		FirstAt   int64
		LastAt    int64
		toolSeen  map[string]bool
		resSeen   map[string]bool
	}
	var groups []*bucket
	var cur *bucket
	for _, log := range logs {
		intent := strings.TrimSpace(log.Intent)
		if cur == nil || cur.Intent != intent || intent == "" {
			cur = &bucket{
				Intent:   intent,
				toolSeen: map[string]bool{},
				resSeen:  map[string]bool{},
				FirstAt:  log.At,
				LastAt:   log.At,
			}
			groups = append(groups, cur)
		}
		cur.Count++
		cur.LogIDs = append(cur.LogIDs, log.ID)
		if log.At > cur.LastAt {
			cur.LastAt = log.At
		}
		if log.At < cur.FirstAt {
			cur.FirstAt = log.At
		}
		if !cur.toolSeen[log.Tool] {
			cur.toolSeen[log.Tool] = true
			cur.Tools = append(cur.Tools, log.Tool)
		}
		for _, r := range log.Resources {
			key := r.Kind + ":" + r.ID
			if !cur.resSeen[key] {
				cur.resSeen[key] = true
				cur.Resources = append(cur.Resources, r)
			}
		}
	}
	out := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		out = append(out, map[string]interface{}{
			"intent":    g.Intent,
			"count":     g.Count,
			"tools":     g.Tools,
			"resources": g.Resources,
			"logIds":    g.LogIDs,
			"firstAt":   g.FirstAt,
			"lastAt":    g.LastAt,
		})
	}
	return out
}

func toolListMCPLogs(ctx context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		Limit          int    `json:"limit"`
		IntentContains string `json:"intentContains"`
		Tool           string `json:"tool"`
		ResourceKind   string `json:"resourceKind"`
		ResourceID     string `json:"resourceId"`
		Caller         string `json:"caller"`
		Since          int64  `json:"since"`
		GroupByIntent  *bool  `json:"groupByIntent"`
	}
	_ = json.Unmarshal(raw, &in)
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	logs, err := d.Store.ListMCPCallLogs(model.MCPCallLogFilter{
		Limit:          in.Limit,
		IntentContains: in.IntentContains,
		Tool:           in.Tool,
		ResourceKind:   in.ResourceKind,
		ResourceID:     in.ResourceID,
		Caller:         in.Caller,
		Since:          in.Since,
	})
	if err != nil {
		return Fail(err.Error())
	}
	group := true
	if in.GroupByIntent != nil {
		group = *in.GroupByIntent
	}
	out := map[string]interface{}{
		"ok":   true,
		"logs": logs,
		"n":    len(logs),
	}
	if group {
		out["byIntent"] = groupMCPLogsByIntent(logs)
	}
	return OKData(out)
}

func toolGetMCPLog(_ context.Context, d *Deps, raw json.RawMessage) ToolResult {
	var in struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &in)
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return Fail("请提供 id（来自 list_mcp_logs）")
	}
	if d == nil || d.Store == nil {
		return Fail("Store 未就绪")
	}
	row, err := d.Store.GetMCPCallLog(id)
	if err != nil {
		return Fail(err.Error())
	}
	return OKData(map[string]interface{}{"ok": true, "log": row})
}

func registerMCPCallLogTools(r *Registry) {
	r.add(ToolDef{
		Name: workbench.CapListMCPLogs,
		Description: "MCP/工具调用审计日志：看「意图 → 触及的产品资源(ssh/db/docker/log/http/note/backup/skill) → 该意图下调了哪些工具」。" +
			"可按 intentContains / resourceKind+resourceId / tool / caller 过滤；默认按意图分组 byIntent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"limit":          map[string]interface{}{"type": "integer", "description": "默认 50，最大 500"},
				"intentContains": map[string]interface{}{"type": "string", "description": "意图子串"},
				"tool":           map[string]interface{}{"type": "string"},
				"resourceKind":   map[string]interface{}{"type": "string", "description": "ssh|database|docker|log|http|note|backup|skill|browser"},
				"resourceId":     map[string]interface{}{"type": "string"},
				"caller":         map[string]interface{}{"type": "string", "description": "mcp|agent:…|default"},
				"since":          map[string]interface{}{"type": "integer", "description": "毫秒时间戳下限"},
				"groupByIntent":  map[string]interface{}{"type": "boolean", "description": "默认 true，返回 byIntent 聚合"},
			},
		},
		Handler: toolListMCPLogs,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetMCPLog,
		Description: "一条 MCP 调用详情（资源/意图/参数摘要/耗时）。id 来自 list_mcp_logs。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id": map[string]interface{}{"type": "string"},
			},
			"required": []string{"id"},
		},
		Handler: toolGetMCPLog,
	})
}

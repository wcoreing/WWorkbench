package workbenchtools

import (
	"encoding/json"
	"strings"

	"WWorkbench/internal/model"
)

// extractMCPResources 从工具参数抽取全产品资源引用（ssh/db/docker/log/http/note/backup/skill/browser/desktop）。
func extractMCPResources(tool string, args json.RawMessage) []model.MCPAssetRef {
	var m map[string]interface{}
	if len(args) == 0 || json.Unmarshal(args, &m) != nil || m == nil {
		m = map[string]interface{}{}
	}
	seen := map[string]bool{}
	var out []model.MCPAssetRef
	add := func(kind, id, label string) {
		id = strings.TrimSpace(id)
		if id == "" || kind == "" {
			return
		}
		key := kind + ":" + id
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, model.MCPAssetRef{Kind: kind, ID: id, Label: strings.TrimSpace(label)})
	}

	str := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := m[k]; ok {
				switch t := v.(type) {
				case string:
					if s := strings.TrimSpace(t); s != "" {
						return s
					}
				}
			}
		}
		return ""
	}

	// SSH
	if id := str("sshHostId", "hostId"); id != "" {
		add(model.MCPAssetSSH, id, "")
	}
	if hostOrName := str("hostOrName"); hostOrName != "" {
		add(model.MCPAssetSSH, hostOrName, hostOrName)
	}

	// Database
	if id := str("connectionId"); id != "" {
		add(model.MCPAssetDatabase, id, "")
	}

	// Docker
	if id := str("dockerContextId", "contextId"); id != "" {
		add(model.MCPAssetDocker, id, "")
	}

	// Log（产品日志源；勿把 browser_network 的 requestId 当资源）
	if id := str("logSourceId"); id != "" {
		add(model.MCPAssetLog, id, "")
	}
	if id := str("sourceId"); id != "" {
		switch tool {
		case "fetch_logs", "logs_open", "save_log_source", "list_log_sources":
			add(model.MCPAssetLog, id, "")
		}
	}

	// HTTP 产品资产（非浏览器网络 requestId）
	if id := str("httpRequestId"); id != "" {
		add(model.MCPAssetHTTP, id, "")
	}
	if id := str("requestId"); id != "" {
		switch tool {
		case "execute_http", "httpapi_open", "save_http_request", "list_http_requests":
			add(model.MCPAssetHTTP, id, "")
		}
	}
	if id := str("environmentId", "httpEnvironmentId"); id != "" {
		add(model.MCPAssetHTTP, id, "env:"+id)
	}

	// Note
	if id := str("noteId"); id != "" {
		add(model.MCPAssetNote, id, "")
	}

	// Backup
	if id := str("policyId"); id != "" {
		add(model.MCPAssetBackup, id, "")
	}

	// Skill
	if id := str("skill", "name", "workflow"); id != "" {
		switch tool {
		case "get_skill", "update_skill", "run_skill", "list_skills", "distill_skill",
			"list_skill_versions", "pin_skill_version", "restore_skill_version",
			"publish_agent_skill", "get_workflow", "save_workflow", "list_workflows",
			"update_agent_skill", "distill_workflow",
			"publish_skill_market", "install_skill_market":
			add(model.MCPAssetSkill, id, "")
		}
	}
	if id := str("dir", "path"); id != "" && (tool == "publish_skill_market") {
		add(model.MCPAssetSkill, id, "")
	}

	// Browser session（任务标签组）
	if session := str("session"); session != "" && (strings.HasPrefix(tool, "browser_") ||
		tool == "task_record" || tool == "list_task_runs" || tool == "get_task_run") {
		add(model.MCPAssetBrowser, session, session)
	}

	// 桌面应用（只给 ref 的调用不带 app，资源归属见任务账本的 locator）
	if app := str("app"); app != "" && isDesktopTool(tool) {
		add(model.MCPAssetDesktop, app, app)
	}

	return out
}

// enrichMCPResourceLabels 用 Store 补全资源显示名。
func enrichMCPResourceLabels(d *Deps, refs []model.MCPAssetRef) []model.MCPAssetRef {
	if d == nil || d.Store == nil || len(refs) == 0 {
		return refs
	}
	out := make([]model.MCPAssetRef, len(refs))
	copy(out, refs)
	for i := range out {
		if out[i].Label != "" {
			continue
		}
		switch out[i].Kind {
		case model.MCPAssetSSH:
			if h, err := d.Store.GetSSHHost(out[i].ID); err == nil && h != nil {
				out[i].Label = h.Name
				if out[i].Label == "" {
					out[i].Label = h.Host
				}
			} else if host, _, _ := resolveSSHHost(d, "", out[i].ID); host != nil {
				out[i].ID = host.ID
				out[i].Label = host.Name
				if out[i].Label == "" {
					out[i].Label = host.Host
				}
			}
		case model.MCPAssetDatabase:
			if c, err := d.Store.GetConnection(out[i].ID); err == nil && c != nil {
				out[i].Label = c.Name
			}
		case model.MCPAssetDocker:
			if c, err := d.Store.GetDockerContext(out[i].ID); err == nil && c != nil {
				out[i].Label = c.Name
			}
		case model.MCPAssetLog:
			if s, err := d.Store.GetLogSource(out[i].ID); err == nil && s != nil {
				out[i].Label = s.Name
			}
		case model.MCPAssetHTTP:
			if r, err := d.Store.GetHTTPRequest(out[i].ID); err == nil && r != nil {
				out[i].Label = r.Name
			} else if e, err := d.Store.GetHTTPEnvironment(out[i].ID); err == nil && e != nil {
				out[i].Label = e.Name
			}
		case model.MCPAssetNote:
			if n, err := d.Store.GetNote(out[i].ID); err == nil && n != nil {
				out[i].Label = n.Title
			}
		case model.MCPAssetBackup:
			if p, err := d.Store.GetBackupPolicy(out[i].ID); err == nil && p != nil {
				out[i].Label = p.Name
			}
		case model.MCPAssetSkill:
			out[i].Label = out[i].ID
		case model.MCPAssetBrowser:
			out[i].Label = out[i].ID
		}
	}
	return out
}

// mcpArgsSummary 保留资源相关键 + intent，截断后落库（不存密码/大 body）。
func mcpArgsSummary(args json.RawMessage) string {
	var m map[string]interface{}
	if len(args) == 0 || json.Unmarshal(args, &m) != nil || m == nil {
		return "{}"
	}
	keepKeys := []string{
		"intent", "command", "sql", "initialSql", "query", "url", "action",
		"sshHostId", "hostId", "hostOrName", "connectionId",
		"dockerContextId", "contextId", "logSourceId", "sourceId",
		"httpRequestId", "requestId", "environmentId", "httpEnvironmentId",
		"noteId", "policyId", "skill", "name", "workflow", "session",
		"runId", "workDir", "path", "role", "findingIds", "mode", "allowWrite",
		"method", "containerId", "fields",
		"app", "ref", "keys", // 桌面：记操作对象与按键，不记输入的文本
	}
	out := map[string]interface{}{}
	for _, k := range keepKeys {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	// command / sql 单独截断，避免整段刷屏
	if c, ok := out["command"].(string); ok && len(c) > 500 {
		out["command"] = c[:500] + "…"
	}
	if s, ok := out["sql"].(string); ok && len(s) > 500 {
		out["sql"] = s[:500] + "…"
	}
	if s, ok := out["initialSql"].(string); ok && len(s) > 300 {
		out["initialSql"] = s[:300] + "…"
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "{}"
	}
	const max = 2000
	if len(b) > max {
		return string(b[:max]) + "…"
	}
	return string(b)
}

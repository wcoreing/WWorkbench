package workbenchtools

import (
	"context"
	"encoding/json"
	"fmt"

	"WWorkbench/internal/workbench"
)

// ToolHandler 工具处理函数。
type ToolHandler func(ctx context.Context, d *Deps, args json.RawMessage) ToolResult

// ToolDef 工具定义（OpenAI function 格式）。
type ToolDef struct {
	Name        string
	Description string
	Parameters  map[string]interface{}
	Handler     ToolHandler
}

// Registry 工具注册表。
type Registry struct {
	deps  *Deps
	tools map[string]ToolDef
	order []string
}

// NewRegistry 创建注册表并注册内置工具。
func NewRegistry(d *Deps) *Registry {
	r := &Registry{deps: d, tools: map[string]ToolDef{}}
	r.registerBuiltins()
	return r
}

// ListDefs 返回全部工具定义（供 LLM）。
func (r *Registry) ListDefs() []ToolDef {
	return r.ListDefsFiltered(nil)
}

// ListDefsFiltered 按权限开关返回可用工具（nil 表示全部启用）。
func (r *Registry) ListDefsFiltered(enabled map[string]bool) []ToolDef {
	out := make([]ToolDef, 0, len(r.order))
	for _, name := range r.order {
		if enabled != nil && !enabled[name] {
			continue
		}
		out = append(out, r.tools[name])
	}
	return out
}

// IsToolEnabled 检查工具是否已授权。
func IsToolEnabled(enabled map[string]bool, name string) bool {
	if enabled == nil {
		return true
	}
	return enabled[name]
}

// Deps 返回工具依赖。
func (r *Registry) Deps() *Deps {
	return r.deps
}

// toolAliases 兼容旧工具名。
var toolAliases = map[string]string{
	"open_terminal":             workbench.CapOpenTerminal,
	"terminal.open":             workbench.CapOpenTerminal,
	"terminal.exec":             workbench.CapTerminalExec,
	"database.open":             workbench.CapDatabaseOpen,
	"notebook.append_content":   workbench.CapNotebookAppend,
}

// Invoke 调用指定工具。
func (r *Registry) Invoke(ctx context.Context, name string, args json.RawMessage, enabled map[string]bool) ToolResult {
	if alias, ok := toolAliases[name]; ok {
		name = alias
	}
	if !IsToolEnabled(enabled, name) {
		return Fail("该能力已在 AI 权限设置中关闭: " + name)
	}
	t, ok := r.tools[name]
	if !ok {
		return Fail(fmt.Sprintf("未知工具: %s", name))
	}
	return t.Handler(ctx, r.deps, args)
}

func (r *Registry) add(def ToolDef) {
	r.tools[def.Name] = def
	r.order = append(r.order, def.Name)
}

func (r *Registry) registerBuiltins() {
	r.add(ToolDef{
		Name:        "get_workbench_context",
		Description: "获取当前工作台上下文：产品线、界面焦点（表/标签）、连接、打开的数据库会话、最近查询历史摘要。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"activeProduct":  map[string]interface{}{"type": "string", "description": "当前产品线"},
				"sessionId":      map[string]interface{}{"type": "string", "description": "当前数据库 sessionId"},
				"connectionId":   map[string]interface{}{"type": "string", "description": "当前连接 ID"},
				"database":       map[string]interface{}{"type": "string", "description": "当前库名"},
				"table":          map[string]interface{}{"type": "string", "description": "界面焦点表名"},
				"focusKind":      map[string]interface{}{"type": "string", "description": "界面焦点类型"},
				"focusLabel":     map[string]interface{}{"type": "string", "description": "界面焦点人话标签"},
				"tabTitle":       map[string]interface{}{"type": "string", "description": "当前标签标题"},
				"openTabsBrief":  map[string]interface{}{"type": "string", "description": "中栏打开标签摘要"},
				"selectionBrief": map[string]interface{}{"type": "string", "description": "树/资源选中摘要"},
			},
		},
		Handler: toolGetWorkbenchContext,
	})
	r.add(ToolDef{
		Name:        "list_connections",
		Description: "列出已保存的数据库连接（不含密码）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListConnections,
	})
	r.add(ToolDef{
		Name:        "list_ssh_hosts",
		Description: "列出已保存的 SSH 主机（不含密码）。用户问「链接/连接」时应与 list_connections 一并使用。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListSSHHosts,
	})
	r.add(ToolDef{
		Name:        "open_database_session",
		Description: "按 connectionId 打开数据库会话，返回 sessionId。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connectionId": map[string]interface{}{"type": "string"},
				"database":     map[string]interface{}{"type": "string", "description": "可选，默认使用连接配置中的库"},
			},
			"required": []interface{}{"connectionId"},
		},
		Handler: toolOpenDatabaseSession,
	})
	r.add(ToolDef{
		Name:        "close_database_session",
		Description: "关闭数据库会话。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"sessionId"},
		},
		Handler: toolCloseDatabaseSession,
	})
	r.add(ToolDef{
		Name:        "list_tables",
		Description: "列出指定会话下某数据库的表与视图名。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{"type": "string"},
				"database":  map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"sessionId", "database"},
		},
		Handler: toolListTables,
	})
	r.add(ToolDef{
		Name:        "describe_table",
		Description: "获取表的列信息。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{"type": "string"},
				"database":  map[string]interface{}{"type": "string"},
				"table":     map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"sessionId", "database", "table"},
		},
		Handler: toolDescribeTable,
	})
	r.add(ToolDef{
		Name:        workbench.CapOpenTerminal,
		Description: "打开本机或 SSH 终端并可选注入命令（用户在终端面板查看，不返回输出）。需要直接拿到命令结果时用 terminal_exec。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"localShell": map[string]interface{}{
					"type":        "boolean",
					"description": "true=本机 Shell；false=SSH（默认）",
				},
				"hostId": map[string]interface{}{
					"type":        "string",
					"description": "SSH 主机 ID（来自 list_ssh_hosts）",
				},
				"hostOrName": map[string]interface{}{
					"type":        "string",
					"description": "IP、主机名或配置名称（与 hostId 二选一）",
				},
				"initialCommand": map[string]interface{}{
					"type":        "string",
					"description": "连接后自动执行的命令，可多行",
				},
			},
		},
		Handler: toolTerminalOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapTerminalExec,
		Description: "无头执行单条只读 Shell 命令并返回 stdout/stderr（uptime、free -h、df -h 等）。禁止 ; | & 重定向与高危命令。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"localShell": map[string]interface{}{"type": "boolean"},
				"hostId":     map[string]interface{}{"type": "string"},
				"hostOrName": map[string]interface{}{"type": "string"},
				"command": map[string]interface{}{
					"type":        "string",
					"description": "单条命令，如 uptime 或 free -h",
				},
				"timeoutSeconds": map[string]interface{}{
					"type":        "integer",
					"description": "超时秒数，默认 30，最大 120",
				},
			},
			"required": []interface{}{"command"},
		},
		Handler: toolTerminalExec,
	})
	r.add(ToolDef{
		Name:        workbench.CapDatabaseOpen,
		Description: "打开数据库工作台：按 connectionId 连接，可选填入 initialSql；runSql=true 时自动执行（只读建议先 readonly 查库）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connectionId": map[string]interface{}{"type": "string"},
				"initialSql":   map[string]interface{}{"type": "string"},
				"runSql":       map[string]interface{}{"type": "boolean"},
				"connectionDraft": map[string]interface{}{
					"type":        "object",
					"description": "新建连接草稿（无 connectionId 时）",
				},
			},
		},
		Handler: toolDatabaseOpen,
	})
	r.add(ToolDef{
		Name:        "execute_sql",
		Description: "在指定会话执行 SQL。readonly=true 时仅允许查询；写入类 SQL 需用户确认后执行。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{"type": "string"},
				"database":  map[string]interface{}{"type": "string"},
				"sql":       map[string]interface{}{"type": "string"},
				"readonly":  map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"sessionId", "sql"},
		},
		Handler: toolExecuteSQL,
	})
	r.add(ToolDef{
		Name:        workbench.CapNotebookAppend,
		Description: "将 Markdown 内容写入笔记本：新建笔记或追加到 appendToNoteId。巡检/总结后应调用此工具留存报告。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"title":          map[string]interface{}{"type": "string", "description": "新笔记标题（追加时可省略）"},
				"content":        map[string]interface{}{"type": "string", "description": "Markdown 正文"},
				"sshHostId":      map[string]interface{}{"type": "string", "description": "关联 SSH 主机 ID（可选）"},
				"connectionId":   map[string]interface{}{"type": "string", "description": "关联数据库连接 ID（可选）"},
				"appendToNoteId": map[string]interface{}{"type": "string", "description": "追加到已有笔记 ID（可选）"},
			},
			"required": []interface{}{"content"},
		},
		Handler: toolNotebookAppend,
	})
	r.add(ToolDef{
		Name:        "list_docker_contexts",
		Description: "列出 Docker 上下文（含本地 local 与 SSH 远端）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListDockerContexts,
	})
	r.add(ToolDef{
		Name:        "list_containers",
		Description: "列出指定 Docker 上下文下的容器（只读）。contextId 省略或为 local 表示本机。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId": map[string]interface{}{"type": "string", "description": "Docker 上下文 ID，默认 local"},
			},
		},
		Handler: toolListContainers,
	})
	r.add(ToolDef{
		Name:        "get_container_logs",
		Description: "读取容器日志尾部（只读），用于排查错误与巡检。tail 默认 200，最大 500。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string"},
				"containerId": map[string]interface{}{"type": "string"},
				"tail":        map[string]interface{}{"type": "integer"},
			},
			"required": []interface{}{"containerId"},
		},
		Handler: toolGetContainerLogs,
	})
	r.add(ToolDef{
		Name:        "list_log_sources",
		Description: "列出已保存的日志源（本机文件、SSH 文件、Docker 容器、Compose）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListLogSources,
	})
	r.add(ToolDef{
		Name:        "fetch_logs",
		Description: "按 logSourceId 拉取日志尾部（只读）。需先用 list_log_sources 获取 ID。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"logSourceId": map[string]interface{}{"type": "string"},
				"tail":        map[string]interface{}{"type": "integer", "description": "行数，默认用源配置，最大 500"},
			},
			"required": []interface{}{"logSourceId"},
		},
		Handler: toolFetchLogs,
	})
	r.add(ToolDef{
		Name:        "list_http_requests",
		Description: "列出已保存的 HTTP 请求模板（方法、URL，不含敏感头）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListHTTPRequests,
	})
	r.add(ToolDef{
		Name:        "list_http_environments",
		Description: "列出 HTTP 环境变量预设（用于 {{var}} 替换）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListHTTPEnvironments,
	})
	r.add(ToolDef{
		Name:        "execute_http",
		Description: "执行 HTTP 请求。GET/HEAD 直接执行；POST/PUT/PATCH/DELETE 等需用户确认。可用 requestId 引用已保存模板。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"requestId": map[string]interface{}{"type": "string", "description": "已保存请求 ID"},
				"method":    map[string]interface{}{"type": "string"},
				"url":       map[string]interface{}{"type": "string"},
				"body":      map[string]interface{}{"type": "string"},
				"envId":     map[string]interface{}{"type": "string", "description": "环境变量预设 ID"},
				"timeoutMs": map[string]interface{}{"type": "integer"},
			},
		},
		Handler: toolExecuteHTTP,
	})
}

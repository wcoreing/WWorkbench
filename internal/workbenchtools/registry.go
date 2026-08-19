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
	"open_terminal":           workbench.CapOpenTerminal,
	"terminal.open":           workbench.CapOpenTerminal,
	"terminal.exec":           workbench.CapTerminalExec,
	"database.open":           workbench.CapDatabaseOpen,
	"notebook.append_content": workbench.CapNotebookAppend,
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
		Description: "工作台快照：连接/SSH/会话，以及当前打开终端最近约 100 行（与可见 PTY 同源）。问「跑完了吗 / 这段输出」先调本工具，不要为了看屏幕再 terminal_exec。",
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
				"noteId":         map[string]interface{}{"type": "string", "description": "当前打开的笔记 ID"},
			},
		},
		Handler: toolGetWorkbenchContext,
	})
	r.add(ToolDef{
		Name:        "list_ssh_hosts",
		Description: "列出已保存的 SSH 主机（不含密码）。用户问「链接/连接」时应与 list_connections 一并使用。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListSSHHosts,
	})
	r.add(ToolDef{
		Name:        "save_ssh_host",
		Description: "将 SSH 主机保存为工作台资产。host/port/user 以用户消息里的 ssh 命令为准；与已有主机地址不同时不要填旧 id（应新建），禁止只改端口却沿用另一台机器的 host。需 keyPath 或 password。落盘后用返回的 hostId 打开终端。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":       map[string]interface{}{"type": "string", "description": "已有主机 ID（更新时填写）"},
				"name":     map[string]interface{}{"type": "string"},
				"host":     map[string]interface{}{"type": "string", "description": "主机名，必须来自用户 ssh 命令（如 connect.westd.seetacloud.com），不要复制已绑定主机的 host"},
				"port":     map[string]interface{}{"type": "integer", "description": "来自 ssh -p，默认 22"},
				"user":     map[string]interface{}{"type": "string"},
				"password": map[string]interface{}{"type": "string", "description": "可选；勿在对用户回复中复述"},
				"keyPath":  map[string]interface{}{"type": "string", "description": "私钥路径，推荐 ~/.ssh/id_ed25519"},
				"reveal":   map[string]interface{}{"type": "boolean", "description": "是否聚焦该主机，默认 true"},
			},
			"required": []interface{}{"host", "user"},
		},
		Handler: toolSaveSSHHost,
	})
	r.add(ToolDef{
		Name:        "list_ssh_forward_presets",
		Description: "列出已保存的 SSH 本地端口转发预设。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListSSHForwardPresets,
	})
	r.add(ToolDef{
		Name:        "save_ssh_forward",
		Description: "将本地→远端端口转发保存为终端资产（侧栏可见）。需 sshHostId；localPort=0 表示启动时自动分配。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":         map[string]interface{}{"type": "string"},
				"name":       map[string]interface{}{"type": "string"},
				"sshHostId":  map[string]interface{}{"type": "string"},
				"localPort":  map[string]interface{}{"type": "integer", "description": "本机监听端口，0=自动"},
				"remoteHost": map[string]interface{}{"type": "string", "description": "经 SSH 可达的远端主机，常为 127.0.0.1"},
				"remotePort": map[string]interface{}{"type": "integer"},
				"reveal":     map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"name", "sshHostId", "remoteHost", "remotePort"},
		},
		Handler: toolSaveSSHForwardPreset,
	})
	r.add(ToolDef{
		Name:        "list_connections",
		Description: "列出已保存的数据库连接（不含密码）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListConnections,
	})
	r.add(ToolDef{
		Name:        "save_connection",
		Description: "将数据库连接保存为工作台资产（连接树可见）。密码可空（用户稍后在 UI 补全）。落盘后用 connectionId 打开会话。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":         map[string]interface{}{"type": "string"},
				"name":       map[string]interface{}{"type": "string"},
				"group":      map[string]interface{}{"type": "string"},
				"dbType":     map[string]interface{}{"type": "string", "description": "mysql / postgresql / redis / sqlite"},
				"host":       map[string]interface{}{"type": "string", "description": "主机；sqlite 为文件路径"},
				"port":       map[string]interface{}{"type": "integer"},
				"user":       map[string]interface{}{"type": "string"},
				"password":   map[string]interface{}{"type": "string", "description": "可选；勿在对用户回复中复述"},
				"database":   map[string]interface{}{"type": "string"},
				"sshEnabled": map[string]interface{}{"type": "boolean"},
				"sshHostId":  map[string]interface{}{"type": "string", "description": "经 SSH 隧道时填 list_ssh_hosts 的 id"},
				"reveal":     map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"dbType", "host"},
		},
		Handler: toolSaveConnection,
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
		Description: "给人看的终端：打开/复用可见 PTY，可选注入命令（pip、下载、训练、脚本、管道）。不返回 stdout；人在面板看输出。本轮「工作台现状」已有最近约 100 行；注入后下一轮用户消息才会带上新输出。禁止编造注入后的 stdout。只读短探针（uptime / nvidia-smi / python -c print）才用 terminal_exec。",
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
		Description: "无头只读短探针：另开 SSH、等结果、默认 30s 最多 120s。白名单如 uptime、free、df、nvidia-smi、ps、ls、cat、pip show、python -c print/import。不改机器状态。pip install / 下载 / 训练 / 脚本 / 管道必须 terminal_open。不踩用户正在看的 PTY。面板最近输出已在工作台现状中，先看再决定是否再探针。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"localShell": map[string]interface{}{"type": "boolean"},
				"hostId":     map[string]interface{}{"type": "string"},
				"hostOrName": map[string]interface{}{"type": "string"},
				"command": map[string]interface{}{
					"type":        "string",
					"description": "只读探针命令行，如 uptime 或 python -c \"import torch; print(torch.__version__)\"。不要 | / ; 串联，不要 install/下载/训练",
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
		Name:        workbench.CapListNotes,
		Description: "列出工作台笔记摘要（标题、noteId、分组，无正文）。读某篇必须 get_note(noteId)。笔记在库内，禁止 cat 文件，禁止用 recall_resource 当笔记。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListNotes,
	})
	r.add(ToolDef{
		Name:        workbench.CapSearchNotes,
		Description: "按标题或正文关键词搜索笔记摘要。找到 noteId 后用 get_note 取全文。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"query": map[string]interface{}{"type": "string", "description": "标题或正文关键词"},
			},
			"required": []interface{}{"query"},
		},
		Handler: toolSearchNotes,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetNote,
		Description: "按 noteId 读取笔记 Markdown 全文。用户说「这篇/当前笔记」时用本轮工作台现状里的 noteId。不要 cat，不要 recall_resource。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"noteId": map[string]interface{}{"type": "string", "description": "笔记 ID"},
			},
			"required": []interface{}{"noteId"},
		},
		Handler: toolGetNote,
	})
	r.add(ToolDef{
		Name:        workbench.CapNotebookAppend,
		Description: "将 Markdown 写入笔记本：新建（须明确 title）或追加到 appendToNoteId。当前打开的笔记常是无关草稿，禁止默认用前馈 noteId。写训练/巡检先 list_notes 按标题定位。界面会打开写入的那篇。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"title":          map[string]interface{}{"type": "string", "description": "新笔记标题（追加时可省略）"},
				"content":        map[string]interface{}{"type": "string", "description": "Markdown 正文"},
				"sshHostId":      map[string]interface{}{"type": "string", "description": "关联 SSH 主机 ID（可选）"},
				"connectionId":   map[string]interface{}{"type": "string", "description": "关联数据库连接 ID（可选）"},
				"appendToNoteId": map[string]interface{}{"type": "string", "description": "追加目标笔记 ID；须 list_notes 按标题确认，不要用当前打开的草稿 ID"},
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
		Name:        "save_docker_context",
		Description: "将 SSH 远端 Docker 保存为工作台上下文资产。需已有 sshHostId；落盘后用 contextId 调 list_containers。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":        map[string]interface{}{"type": "string"},
				"name":      map[string]interface{}{"type": "string"},
				"sshHostId": map[string]interface{}{"type": "string"},
				"reveal":    map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"sshHostId"},
		},
		Handler: toolSaveDockerContext,
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
		Name:        "start_container",
		Description: "启动已存在的容器（需用户确认）。勿用 terminal_exec 执行 docker start。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string", "description": "Docker 上下文 ID，默认 local"},
				"containerId": map[string]interface{}{"type": "string", "description": "容器名称或 ID"},
			},
			"required": []interface{}{"containerId"},
		},
		Handler: toolStartContainer,
	})
	r.add(ToolDef{
		Name:        "stop_container",
		Description: "停止运行中的容器（需用户确认）。勿用 terminal_exec 执行 docker stop。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string"},
				"containerId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"containerId"},
		},
		Handler: toolStopContainer,
	})
	r.add(ToolDef{
		Name:        "remove_container",
		Description: "删除容器（force，需用户确认）。勿用 terminal_exec 执行 docker rm。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string"},
				"containerId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"containerId"},
		},
		Handler: toolRemoveContainer,
	})
	r.add(ToolDef{
		Name:        "list_log_sources",
		Description: "列出已保存的日志源（本机文件、SSH 文件、Docker 容器、Compose）。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListLogSources,
	})
	r.add(ToolDef{
		Name:        "save_log_source",
		Description: "将日志源保存为工作台资产（日志中心可见）。应先 save 再 fetch_logs(logSourceId=…)，勿只临时候路径读完就结束。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":              map[string]interface{}{"type": "string"},
				"name":            map[string]interface{}{"type": "string"},
				"sourceType":      map[string]interface{}{"type": "string", "description": "local_file / ssh_file / docker / compose"},
				"path":            map[string]interface{}{"type": "string"},
				"sshHostId":       map[string]interface{}{"type": "string"},
				"dockerContextId": map[string]interface{}{"type": "string"},
				"containerId":     map[string]interface{}{"type": "string"},
				"composeDir":      map[string]interface{}{"type": "string"},
				"composeService":  map[string]interface{}{"type": "string"},
				"tailLines":       map[string]interface{}{"type": "integer"},
				"reveal":          map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"name", "sourceType"},
		},
		Handler: toolSaveLogSource,
	})
	r.add(ToolDef{
		Name:        "fetch_logs",
		Description: "按 logSourceId 拉取日志尾部（只读）。优先引用已保存资产；新源应先 save_log_source。",
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
		Name:        "save_http_environment",
		Description: "保存 HTTP 环境变量预设（varsJson 对象）。与 save_http_request 配套，execute_http 传 envId。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":       map[string]interface{}{"type": "string"},
				"name":     map[string]interface{}{"type": "string"},
				"varsJson": map[string]interface{}{"type": "string", "description": "如 {\"baseUrl\":\"https://api.example.com\"}"},
				"reveal":   map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"name"},
		},
		Handler: toolSaveHTTPEnvironment,
	})
	r.add(ToolDef{
		Name:        "save_http_request",
		Description: "将 HTTP 请求保存为工作台资产（树中可见、可复现）。调试新接口应先 save 再 execute_http(requestId=…)。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":          map[string]interface{}{"type": "string", "description": "已有请求 ID（更新时填写）"},
				"name":        map[string]interface{}{"type": "string", "description": "显示名称，可省略则按 URL 生成"},
				"method":      map[string]interface{}{"type": "string"},
				"url":         map[string]interface{}{"type": "string"},
				"body":        map[string]interface{}{"type": "string"},
				"folderId":    map[string]interface{}{"type": "string"},
				"notes":       map[string]interface{}{"type": "string"},
				"headersJson": map[string]interface{}{"type": "string", "description": "KV JSON 数组字符串"},
				"paramsJson":  map[string]interface{}{"type": "string"},
				"cookiesJson": map[string]interface{}{"type": "string"},
				"reveal":      map[string]interface{}{"type": "boolean", "description": "是否聚焦该请求，默认 true"},
			},
			"required": []interface{}{"url"},
		},
		Handler: toolSaveHTTPRequest,
	})
	r.add(ToolDef{
		Name:        "execute_http",
		Description: "执行 HTTP 请求。优先 requestId 引用已保存资产；临时 URL 仅用于探路，探通后应 save_http_request。GET/HEAD 直接执行；写方法需确认。",
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
	r.add(ToolDef{
		Name:        workbench.CapLogsOpen,
		Description: "打开日志中心：按 logSourceId 聚焦已有源，或按 Docker/SSH 外键起草并拉取。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"logSourceId":     map[string]interface{}{"type": "string"},
				"sourceType":      map[string]interface{}{"type": "string", "description": "local_file|ssh_file|docker|compose"},
				"name":            map[string]interface{}{"type": "string"},
				"path":            map[string]interface{}{"type": "string"},
				"sshHostId":       map[string]interface{}{"type": "string"},
				"dockerContextId": map[string]interface{}{"type": "string"},
				"containerId":     map[string]interface{}{"type": "string"},
				"composeDir":      map[string]interface{}{"type": "string"},
				"composeService":  map[string]interface{}{"type": "string"},
				"fetch":           map[string]interface{}{"type": "boolean", "description": "打开后是否立即拉取，默认 true"},
			},
		},
		Handler: toolLogsOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapHTTPAPIOpen,
		Description: "打开 API 工作台，可选 requestId 聚焦已保存请求。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"requestId": map[string]interface{}{"type": "string"},
			},
		},
		Handler: toolHTTPAPIOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapEnvironmentOpen,
		Description: "打开本机环境工作台：可选 lang（node/go/php/java）打开版本切换，或 presetId 聚焦预设。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"lang":         map[string]interface{}{"type": "string", "description": "node|go|php|java"},
				"presetId":     map[string]interface{}{"type": "string"},
				"openVersions": map[string]interface{}{"type": "boolean", "description": "是否打开版本列表，默认在提供 lang 时为 true"},
			},
		},
		Handler: toolEnvironmentOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapSSHForwardOpen,
		Description: "打开终端侧栏 SSH 隧道：可选 hostId 新建，或 presetId 编辑已有预设。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"hostId":   map[string]interface{}{"type": "string", "description": "预填 SSH 主机 ID"},
				"presetId": map[string]interface{}{"type": "string"},
				"openNew":  map[string]interface{}{"type": "boolean"},
			},
		},
		Handler: toolSSHForwardOpen,
	})
}

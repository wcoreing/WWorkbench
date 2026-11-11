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
	MCPOnly     bool // 仅 MCP 外置客户端，不注入 Agent 工具环
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

// ListDefsFiltered 按权限开关返回可用工具（nil 表示全部启用）；不含 MCPOnly。
func (r *Registry) ListDefsFiltered(enabled map[string]bool) []ToolDef {
	out := make([]ToolDef, 0, len(r.order))
	for _, name := range r.order {
		if enabled != nil && !enabled[name] {
			continue
		}
		def := r.tools[name]
		if def.MCPOnly {
			continue
		}
		out = append(out, def)
	}
	return out
}

// ListMCPDefs 返回全部 MCP 工具（含 MCPOnly）。
func (r *Registry) ListMCPDefs() []ToolDef {
	out := make([]ToolDef, 0, len(r.order))
	for _, name := range r.order {
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
	"open_terminal":           workbench.CapShellRun,
	"terminal.open":           workbench.CapShellRun,
	"terminal_open":           workbench.CapShellRun,
	"terminal.exec":           workbench.CapShellProbe,
	"terminal_exec":           workbench.CapShellProbe,
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
	// 第三方 MCP：动手类工具前必须已读 get_agent_rules（内置 Agent 开跑会 Mark）
	if requiresAgentRulesAck(name) && !AgentRulesAcked() {
		return Fail(errNeedAgentRules)
	}
	// 意图声明卡：动手类须人话 intent（确认标题 / 舞台回放）
	if requiresIntent(name, args) {
		if errMsg := validateIntent(extractIntent(args)); errMsg != "" {
			return Fail(errMsg)
		}
	}
	// 统一规则：参数能解析到 SSH 主机 → 先打开/聚焦可见终端，再执行工具
	ensureSSHTerminalStage(r.deps, name, args)
	res := t.Handler(ctx, r.deps, args)
	if res.NeedsConfirm {
		res = enrichConfirmWithIntent(name, args, res)
	} else if intent := extractIntent(args); intent != "" && requiresIntent(name, args) {
		RecordIntentCard(IntentCard{Tool: name, Intent: intent, Summary: intent})
	}
	return res
}

func (r *Registry) add(def ToolDef) {
	r.tools[def.Name] = def
	r.order = append(r.order, def.Name)
}

func (r *Registry) registerBuiltins() {
	r.add(ToolDef{
		Name: workbench.CapGetAgentRules,
		Description: "【第三方 Agent 强制首步】返回 WWorkbench 系统约束全文（舞台/确认/数据文件防护/终端用法等）并标记已读。" +
			"新会话或重启后，在 shell_run / execute_sql / 容器与插件写等动手操作之前必须先调用；未读将被拒绝。",
		Parameters: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
		MCPOnly: true,
		Handler: toolGetAgentRules,
	})
	r.add(ToolDef{
		Name:        "get_workbench_context",
		Description: "工作台快照：连接/SSH/会话、打开中的终端列表（sessionId/hostId/totalLines，不含正文）；含近期 intentCards、taskRuns、memoryNotes（焦点绑定的记忆）。问终端输出用 get_shell_output。新会话请先 get_agent_rules。",
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
		Name:        workbench.CapListBackupPolicies,
		Description: "列出备份策略资产（files/sqlite/db）。写前防护与 run_backup 都引用这些策略。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListBackupPolicies,
	})
	r.add(ToolDef{
		Name:        workbench.CapSaveBackupPolicy,
		Description: "保存备份策略（对齐云盘快照）。kind=files|sqlite 须 path+可选 sshHostId；kind=db 须 connectionId。保留：retainDays>0 按天（默认 7），否则 retainCount 按份数配额（0=不清理）。cronExpr 五段定时。须填 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":           map[string]interface{}{"type": "string"},
				"name":         map[string]interface{}{"type": "string"},
				"kind":         map[string]interface{}{"type": "string", "description": "files | sqlite | db"},
				"sshHostId":    map[string]interface{}{"type": "string"},
				"connectionId": map[string]interface{}{"type": "string"},
				"path":         map[string]interface{}{"type": "string", "description": "files/sqlite 绝对路径"},
				"destRoot":     map[string]interface{}{"type": "string"},
				"beforeWrite":  map[string]interface{}{"type": "boolean"},
				"retainDays":   map[string]interface{}{"type": "integer", "description": "自定义保留天数（优先）；默认 7"},
				"retainCount":  map[string]interface{}{"type": "integer", "description": "持续保留配额份数；retainDays=0 时生效"},
				"cronExpr":     map[string]interface{}{"type": "string", "description": "五段 cron；空=不定时"},
				"enabled":      map[string]interface{}{"type": "boolean"},
				"intent":       intentProp(),
			},
			"required": []interface{}{"name", "kind"},
		},
		Handler: toolSaveBackupPolicy,
	})
	r.add(ToolDef{
		Name:        workbench.CapRunBackup,
		Description: "按 policyId 无头执行备份（不跳终端）。成功后按 retainDays/retainCount 清理本策略旧份。写库前若 beforeWrite 且无新鲜备份会自动跑。须填 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"policyId": map[string]interface{}{"type": "string"},
				"intent":   intentProp(),
				"force":    map[string]interface{}{"type": "boolean", "description": "忽略新鲜窗口强制再备"},
			},
			"required": []interface{}{"policyId"},
		},
		Handler: toolRunBackup,
	})
	r.add(ToolDef{
		Name:        workbench.CapListBackupRuns,
		Description: "列出备份执行记录（可按 policyId 过滤）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"policyId": map[string]interface{}{"type": "string"},
				"limit":    map[string]interface{}{"type": "integer"},
			},
		},
		Handler: toolListBackupRuns,
	})
	r.add(ToolDef{
		Name:        workbench.CapHostHealthScan,
		Description: "在指定工作目录扫描可备份资产（*.db/.env/data 与目录本身）。须 sshHostId+绝对 workDir；禁止全盘扫。结果交用户勾选后再 ensure_host_backup_policies。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sshHostId": map[string]interface{}{"type": "string", "description": "SSH 主机 ID"},
				"workDir":   map[string]interface{}{"type": "string", "description": "绝对工作目录，例如 /www/wwwroot/app"},
			},
			"required": []interface{}{"sshHostId", "workDir"},
		},
		Handler: toolHostHealthScan,
	})
	r.add(ToolDef{
		Name:        workbench.CapEnsureHostBackupPolicies,
		Description: "仅为用户勾选的 findingIds 创建备份策略（写前+7 天；默认每天 3:00）。须 sshHostId+workDir+findingIds+intent；禁止默认全选。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sshHostId":   map[string]interface{}{"type": "string"},
				"workDir":     map[string]interface{}{"type": "string"},
				"findingIds":  map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "host_health_scan 返回的可选 finding.id"},
				"withCron":    map[string]interface{}{"type": "boolean", "description": "是否装定时，默认 true"},
				"intent":      intentProp(),
			},
			"required": []interface{}{"sshHostId", "workDir", "findingIds", "intent"},
		},
		Handler: toolEnsureHostBackupPolicies,
	})
	r.add(ToolDef{
		Name:        workbench.CapShellRun,
		Description: "给人看的 Shell：打开/复用可见 PTY，可选注入命令（pip、下载、训练、脚本、管道）。有 initialCommand 时必须填 intent（人话：要干什么、影响谁）。会前置工作台并点亮对应终端+状态栏。风险命令先工作台拍板（标题为人话意图）；目录护照不可免除数据硬风险。确认后对 rsync 自动 --exclude *.db/data/.env，并对目标做写前备份（命中 backup policy 则用其 destRoot）。不返回 stdout；返回 sessionId/updatedAt（毫秒基线）。注入后立刻 get_shell_output(waitMs, afterUpdatedAt=updatedAt)。只读短探针才用 shell_probe。",
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
					"description": "连接后自动注入到可见 PTY，可多行。行首空格与空行会原样送进终端（Python/heredoc 可用）。不返回 stdout。",
				},
				"intent": intentProp(),
			},
		},
		Handler: toolTerminalOpen,
	})
	r.add(ToolDef{
		Name:        workbench.CapShellProbe,
		Description: "无头只读短探针：另开 SSH、等结果、默认 30s 最多 120s。白名单如 uptime、free、df、nvidia-smi、ps、ls、cat、pip show、python -c print/import。不改机器状态。pip install / 下载 / 训练 / 脚本 / 管道必须 shell_run。看可见终端输出用 get_shell_output，不踩用户 PTY。",
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
		Name:        workbench.CapGetShellOutput,
		Description: "分页读取可见 PTY scrollback（与终端面板同源）。offsetFromEnd=0 为最新一页；hasMoreOlder 为 true 时用 nextOffsetFromEnd 继续向历史翻。shell_run 后务必带 afterUpdatedAt=其 updatedAt，并设 waitMs（短命令 3～8s，长任务 15～30s）；已有新输出则立刻返回。返回 waitedMs（真实耗时）/timedOut/updatedAt。问「跑完了吗/报错/这段输出」先调本工具，不要编造。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{
					"type":        "string",
					"description": "终端 sessionId（openTerminals 或 get_workbench_context.terminalSessionId）",
				},
				"terminalSessionId": map[string]interface{}{
					"type":        "string",
					"description": "同 sessionId",
				},
				"hostId": map[string]interface{}{
					"type":        "string",
					"description": "SSH/Docker 主机 ID；与 sessionId 二选一，取该主机最近活动的终端",
				},
				"lines": map[string]interface{}{
					"type":        "integer",
					"description": "本页行数，默认 100，最大 500",
				},
				"offsetFromEnd": map[string]interface{}{
					"type":        "integer",
					"description": "从尾部向历史偏移行数；0=最新一页，翻页用返回的 nextOffsetFromEnd",
				},
				"waitMs": map[string]interface{}{
					"type":        "integer",
					"description": "阻塞等待新输出的毫秒数（最大 120000）。短命令 3000～8000，长任务 15000～30000",
				},
				"afterUpdatedAt": map[string]interface{}{
					"type":        "integer",
					"description": "shell_run/上次返回的 updatedAt（毫秒；秒值亦兼容）。当前已有更新则立刻返回，否则等到新输出或 waitMs 超时",
				},
			},
		},
		Handler: toolGetShellOutput,
	})
	r.add(ToolDef{
		Name:        workbench.CapTerminalReconnect,
		Description: "重连已打开的可见终端（本机/SSH/Docker）：关闭旧 PTY 并新开，面板保留历史输出。按 sessionId 或 hostId/hostOrName/localShell 定位；若尚无对应标签则新开连接。会话断开、[会话已结束] 后先调本工具再 shell_run/get_shell_output。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{
					"type":        "string",
					"description": "终端 sessionId（openTerminals / get_workbench_context）",
				},
				"terminalSessionId": map[string]interface{}{
					"type":        "string",
					"description": "同 sessionId",
				},
				"hostId": map[string]interface{}{
					"type":        "string",
					"description": "SSH/Docker 主机 ID（来自 list_ssh_hosts）",
				},
				"hostOrName": map[string]interface{}{
					"type":        "string",
					"description": "IP、主机名或配置名称（与 hostId 二选一）",
				},
				"localShell": map[string]interface{}{
					"type":        "boolean",
					"description": "true=重连本机终端",
				},
			},
		},
		Handler: toolTerminalReconnect,
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
		Description: "在指定会话执行 SQL。readonly=true 时仅允许查询；写入类 SQL 需用户确认后执行，并须填 intent 意图声明。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sessionId": map[string]interface{}{"type": "string"},
				"database":  map[string]interface{}{"type": "string"},
				"sql":       map[string]interface{}{"type": "string"},
				"readonly":  map[string]interface{}{"type": "boolean", "description": "默认 true"},
				"intent":    intentProp(),
			},
			"required": []interface{}{"sessionId", "sql"},
		},
		Handler: toolExecuteSQL,
	})
	r.add(ToolDef{
		Name: workbench.CapListNotes,
		Description: "列出运维知识库文件摘要（标题、noteId、language、role、sshHostId，无正文）。" +
			"管某台服务器时传 sshHostId；找记忆传 role=memory。读全文用 get_note。禁止 cat / recall_resource。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"sshHostId": map[string]interface{}{"type": "string", "description": "只列绑定该 SSH 主机的文件"},
				"role":      map[string]interface{}{"type": "string", "description": "note|memory|skill（工作流）"},
			},
		},
		Handler: toolListNotes,
	})
	r.add(ToolDef{
		Name:        workbench.CapSearchNotes,
		Description: "按标题/正文搜运维知识库。可加 sshHostId 限定主机。找到 noteId 后 get_note。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"query":     map[string]interface{}{"type": "string", "description": "标题或正文关键词"},
				"sshHostId": map[string]interface{}{"type": "string", "description": "限定绑定该 SSH 主机"},
			},
			"required": []interface{}{"query"},
		},
		Handler: toolSearchNotes,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetNote,
		Description: "按 noteId 读知识库全文（脚本/配置/记忆均可）。动手改某台机前先读其 memory。不要 cat，不要 recall_resource。",
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
		Name: workbench.CapNotebookAppend,
		Description: "把服务器运维知识写入笔记本 IDE：巡检记录、shell 脚本、配置片段、主机记忆。" +
			"新建须 title；管某台机必填 sshHostId。脚本用 language=shell；主机长期上下文用 role=memory。" +
			"禁止默认往当前打开的草稿追加；先 list_notes(sshHostId) 定位。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"title":          map[string]interface{}{"type": "string", "description": "新文件标题（追加时可省略）"},
				"content":        map[string]interface{}{"type": "string", "description": "正文（md/脚本/配置）"},
				"language":       map[string]interface{}{"type": "string", "description": "文件类型：markdown|shell|yaml|sql|json|python… 默认 markdown"},
				"role":           map[string]interface{}{"type": "string", "description": "note|memory|skill（工作流）；主机长期上下文用 memory"},
				"sshHostId":      map[string]interface{}{"type": "string", "description": "关联 SSH 主机（管服务器时强烈建议）"},
				"connectionId":   map[string]interface{}{"type": "string", "description": "关联数据库连接 ID（可选）"},
				"appendToNoteId": map[string]interface{}{"type": "string", "description": "追加目标；须 list_notes 确认，勿用无关打开草稿"},
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
		Description: "启动已存在的容器（需用户确认）。勿用 shell_probe 执行 docker start。须填 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string", "description": "Docker 上下文 ID，默认 local"},
				"containerId": map[string]interface{}{"type": "string", "description": "容器名称或 ID"},
				"intent":      intentProp(),
			},
			"required": []interface{}{"containerId"},
		},
		Handler: toolStartContainer,
	})
	r.add(ToolDef{
		Name:        "stop_container",
		Description: "停止运行中的容器（需用户确认）。勿用 shell_probe 执行 docker stop。须填 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string"},
				"containerId": map[string]interface{}{"type": "string"},
				"intent":      intentProp(),
			},
			"required": []interface{}{"containerId"},
		},
		Handler: toolStopContainer,
	})
	r.add(ToolDef{
		Name:        "remove_container",
		Description: "删除容器（force，需用户确认）。勿用 shell_probe 执行 docker rm。须填 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"contextId":   map[string]interface{}{"type": "string"},
				"containerId": map[string]interface{}{"type": "string"},
				"intent":      intentProp(),
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
		Description: "执行 HTTP 请求。优先 requestId 引用已保存资产；临时 URL 仅用于探路，探通后应 save_http_request。GET/HEAD 直接执行；写方法需确认。动手须填 intent。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"requestId": map[string]interface{}{"type": "string", "description": "已保存请求 ID"},
				"method":    map[string]interface{}{"type": "string"},
				"url":       map[string]interface{}{"type": "string"},
				"body":      map[string]interface{}{"type": "string"},
				"envId":     map[string]interface{}{"type": "string", "description": "环境变量预设 ID"},
				"timeoutMs": map[string]interface{}{"type": "integer"},
				"intent":    intentProp(),
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
		Name:        workbench.CapBackupOpen,
		Description: "打开备份工作台：按 policyId 聚焦，或 create=true 按 path/sshHostId/connectionId 起草新策略。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"policyId":     map[string]interface{}{"type": "string"},
				"name":         map[string]interface{}{"type": "string"},
				"kind":         map[string]interface{}{"type": "string"},
				"path":         map[string]interface{}{"type": "string"},
				"sshHostId":    map[string]interface{}{"type": "string"},
				"connectionId": map[string]interface{}{"type": "string"},
				"create":       map[string]interface{}{"type": "boolean"},
			},
		},
		Handler: toolBackupOpen,
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
	r.add(ToolDef{
		Name: workbench.CapListSkills,
		Description: "列出笔记本工作流（~/.wworkbench/notebook/工作流/）。返回 id/name/description/noteId/diskPath/hasSteps。",
		Parameters: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
		Handler: toolListSkills,
	})
	r.add(ToolDef{
		Name: workbench.CapGetSkill,
		Description: "读取笔记本工作流/Skill 正文（~/.wworkbench/notebook/工作流/{name}/SKILL.md）。返回 content + diskPath/skillDir/assetsDir；优先读后自己用工具执行。含步骤时也可选 run_skill。参数 skill=id|name。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"skill": map[string]interface{}{"type": "string", "description": "skill id 或 name"},
				"id":    map[string]interface{}{"type": "string"},
				"name":  map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"skill"},
		},
		Handler: toolGetSkill,
	})
	r.add(ToolDef{
		Name: workbench.CapPublishAgentSkill,
		Description: "将笔记标为工作流（role=skill + skillId）。真源仅笔记本目录；优先传 noteId 与 id（短名）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":          map[string]interface{}{"type": "string", "description": "工作流 id；空则从笔记关联/标题推导"},
				"name":        map[string]interface{}{"type": "string", "description": "显示名"},
				"description": map[string]interface{}{"type": "string", "description": "/ 菜单一句话说明"},
				"content":     map[string]interface{}{"type": "string", "description": "可选；空则读笔记"},
				"noteId":      map[string]interface{}{"type": "string", "description": "来源笔记 ID（推荐）"},
			},
			"required": []interface{}{"noteId"},
		},
		Handler: toolPublishAgentSkill,
	})
	r.add(ToolDef{
		Name:        workbench.CapUpdateAgentSkill,
		Description: "已废弃：勿写 system/skills。请改用 update_skill 写笔记本工作流。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"id":            map[string]interface{}{"type": "string", "description": "工作流 id"},
				"content":       map[string]interface{}{"type": "string", "description": "SKILL.md 正文（不含 frontmatter）"},
				"name":          map[string]interface{}{"type": "string", "description": "显示名"},
				"description":   map[string]interface{}{"type": "string", "description": "/ 菜单一句话说明"},
				"updateContent": map[string]interface{}{"type": "boolean", "description": "是否更新正文，content 非空时默认 true"},
				"updateGlobs":   map[string]interface{}{"type": "boolean", "description": "是否更新 globs"},
				"globs":         map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
			},
			"required": []interface{}{"id"},
		},
		Handler: toolUpdateAgentSkill,
	})
	r.add(ToolDef{
		Name:        workbench.CapListPluginPacks,
		Description: "列出工作台插件包（~/.wworkbench/plugins）。用户说「db 插件 / 数据库插件 / pack UI」指这个，不是数据库连接。改界面先 list 再读 src/ui。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolListPluginPacks,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetPluginPack,
		Description: "获取单个插件包：源码/产物路径、是否已构建 UI、ww-cap 兼容（capOk/capDetail）。packId 如 database。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId": map[string]interface{}{"type": "string", "description": "如 database"},
			},
			"required": []interface{}{"packId"},
		},
		Handler: toolGetPluginPack,
	})
	r.add(ToolDef{
		Name:        workbench.CapGetPluginProtocol,
		Description: "读取平台 Host↔Pack 插件协议 SSOT（PROTOCOL.md + hostCapVersion）。改任何 pack 前必须先调用；勿 list_skills；各 pack 的 HOST.md 只是补充。",
		Parameters:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
		Handler:     toolGetPluginProtocol,
	})
	r.add(ToolDef{
		Name:        workbench.CapListPluginPackFiles,
		Description: "列出某插件包源码相对路径。协议用 get_plugin_protocol；database 产品 UI 一般在 src/ui/src/DatabaseWorkbench.tsx。不要用 read_file（那是 ningharness 技能脚本）。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"packId"},
		},
		Handler: toolListPluginPackFiles,
	})
	r.add(ToolDef{
		Name: workbench.CapReadPluginPackFile,
		Description: "按行分段读取插件源码（避免整文件顶满上下文被截断）。" +
			"relPath 相对 ~/.wworkbench/plugins/<packId>。" +
			"大文件用 startLine/maxLines 翻页：看返回 hasMore/nextStartLine，再读下一段；不要 recall_resource 拼全文。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId":     map[string]interface{}{"type": "string"},
				"relPath":    map[string]interface{}{"type": "string"},
				"startLine":  map[string]interface{}{"type": "integer", "description": "从第几行开始（1-based），默认 1"},
				"maxLines":   map[string]interface{}{"type": "integer", "description": "最多读多少行，默认 220，最大 400"},
			},
			"required": []interface{}{"packId", "relPath"},
		},
		Handler: toolReadPluginPackFile,
	})
	r.add(ToolDef{
		Name: workbench.CapEditPluginPackFile,
		Description: "局部编辑插件源码（需确认）：用 oldString→newString 精确替换，适合大文件。" +
			"默认 oldString 必须唯一匹配；多处时扩大上下文或设 replaceAll=true。" +
			"只改源码不会立刻变界面，确认后再 build_plugin_pack_ui。优先于 write_plugin_pack_file。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId":     map[string]interface{}{"type": "string"},
				"relPath":    map[string]interface{}{"type": "string"},
				"oldString":  map[string]interface{}{"type": "string", "description": "文件中必须存在的原文片段（含缩进）"},
				"newString":  map[string]interface{}{"type": "string", "description": "替换后的文本；空串表示删除该片段"},
				"replaceAll": map[string]interface{}{"type": "boolean", "description": "true 时替换全部匹配；默认 false（须唯一）"},
			},
			"required": []interface{}{"packId", "relPath", "oldString", "newString"},
		},
		Handler: toolEditPluginPackFile,
	})
	r.add(ToolDef{
		Name:        workbench.CapWritePluginPackFile,
		Description: "整文件覆盖写插件源码（需确认）。仅新建文件或大幅重写时用；已有大文件局部改请用 edit_plugin_pack_file。只改源码不会立刻变界面，确认后再 build_plugin_pack_ui。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId":  map[string]interface{}{"type": "string"},
				"relPath": map[string]interface{}{"type": "string"},
				"content": map[string]interface{}{"type": "string", "description": "完整文件 UTF-8 正文"},
			},
			"required": []interface{}{"packId", "relPath", "content"},
		},
		Handler: toolWritePluginPackFile,
	})
	r.add(ToolDef{
		Name:        workbench.CapBuildPluginPackUI,
		Description: "构建插件 UI 到 ~/.wworkbench/run/<packId>/ui（需确认）。成功后自动写入 releases 快照，产品线热加载。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"packId"},
		},
		Handler: toolBuildPluginPackUI,
	})
	r.add(ToolDef{
		Name:        workbench.CapListPluginPackReleases,
		Description: "列出插件历史版本（~/.wworkbench/releases/<packId>）。回滚前先看 releaseId。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId": map[string]interface{}{"type": "string"},
			},
			"required": []interface{}{"packId"},
		},
		Handler: toolListPluginPackReleases,
	})
	r.add(ToolDef{
		Name:        workbench.CapRollbackPluginPack,
		Description: "回滚插件到指定 release（需确认）。恢复源码与 UI；回滚前会自动快照当前。",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"packId":    map[string]interface{}{"type": "string"},
				"releaseId": map[string]interface{}{"type": "string", "description": "list_plugin_pack_releases 返回的 id"},
			},
			"required": []interface{}{"packId", "releaseId"},
		},
		Handler: toolRollbackPluginPack,
	})
	r.add(offerChoicesToolDef())
	r.add(ToolDef{
		Name:        workbench.CapAgentChat,
		Description: "同步发起 Agent 对话并等待回复（解析 /skill 前缀；mode 默认 agent）。外置 MCP 闭环测试用，不注入 Agent 工具环。",
		MCPOnly:     true,
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"message":  map[string]interface{}{"type": "string", "description": "用户消息；可用 /skill-id 开头手动挂载技能"},
				"threadId": map[string]interface{}{"type": "string", "description": "续聊线程 id，空则新建"},
				"mode":     map[string]interface{}{"type": "string", "description": "ask | agent | plan，默认 agent"},
				"skillIds":  map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "显式 skill id（非空时跳过 / 解析）"},
				"noteId":    map[string]interface{}{"type": "string", "description": "可选：写入 Agent 前馈的当前笔记 id"},
				"sshHostId": map[string]interface{}{"type": "string", "description": "可选：绑定 SSH 主机 id（等价于 mentions 里 kind=ssh）"},
				"mentions": map[string]interface{}{
					"type": "array",
					"items": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"kind":  map[string]interface{}{"type": "string", "description": "ssh | database | docker | log | http"},
							"id":    map[string]interface{}{"type": "string"},
							"label": map[string]interface{}{"type": "string"},
						},
						"required": []interface{}{"kind", "id"},
					},
					"description": "可选：@ 绑定资源（与 UI 侧栏一致）",
				},
			},
			"required": []interface{}{"message"},
		},
		Handler: toolAgentChat,
	})
	r.add(ToolDef{
		Name:        workbench.CapAgentConfirm,
		Description: "确认或拒绝 agent_chat 返回的 pendingId，并同步等待续跑结束。",
		MCPOnly:     true,
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"pendingId": map[string]interface{}{"type": "string"},
				"approved":  map[string]interface{}{"type": "boolean", "description": "默认 true"},
			},
			"required": []interface{}{"pendingId"},
		},
		Handler: toolAgentConfirm,
	})
	registerBrowserTools(r)
}

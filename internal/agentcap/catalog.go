package agentcap

import "strings"

// Risk 工具风险级别。
type Risk string

const (
	RiskRead    Risk = "read"
	RiskSession Risk = "session"
	RiskWrite   Risk = "write"
)

// Item 工具能力目录项。
type Item struct {
	Name           string `json:"name"`
	Label          string `json:"label"`
	Risk           Risk   `json:"risk"`
	Description    string `json:"description"`
	NeedsConfirm   bool   `json:"needsConfirm"`
	DefaultEnabled bool   `json:"defaultEnabled"`
}

// Catalog 当前 Agent 可注册的全部能力。
func Catalog() []Item {
	return []Item{
		{
			Name: "get_workbench_context", Label: "读取工作台上下文", Risk: RiskRead,
			Description:    "产品线/连接/SSH，以及打开中的终端列表（不含正文）",
			DefaultEnabled: true,
		},
		{
			Name: "recall_resource", Label: "跨轮召回资源全文", Risk: RiskRead,
			Description:    "从 ningharness 外置资源表取回工具结果全文（本轮结果已在上下文，勿对本轮调用）",
			DefaultEnabled: true,
		},
		{
			Name: "search_session", Label: "检索历史对话", Risk: RiskRead,
			Description:    "按关键词搜历史会话；全文再用 recall_resource",
			DefaultEnabled: true,
		},
		{
			Name: "get_task_summary", Label: "任务台账摘要", Risk: RiskRead,
			Description:    "单轮执行短摘要（不含工具全文）",
			DefaultEnabled: true,
		},
		{
			Name: "list_skills", Label: "列出技能", Risk: RiskRead,
			Description:    "列出 system/skills 下已启用技能（id / name / description）",
			DefaultEnabled: true,
		},
		{
			Name: "get_skill", Label: "加载技能正文", Risk: RiskRead,
			Description:    "读取 SKILL.md 与 lesson 经验；/ 挂载后首轮须调用",
			DefaultEnabled: true,
		},
		{
			Name: "read_file", Label: "读取项目文件", Risk: RiskRead,
			Description:    "读取 ningharness 项目内文本（含 skill scripts）",
			DefaultEnabled: true,
		},
		{
			Name: "list_ssh_hosts", Label: "列出 SSH 主机", Risk: RiskRead,
			Description:    "已保存的 SSH 主机配置（不含密码，用于终端/SFTP）",
			DefaultEnabled: true,
		},
		{
			Name: "save_ssh_host", Label: "保存 SSH 主机资产", Risk: RiskWrite,
			Description:    "写入 SSH 主机；host/port 以用户 ssh 命令为准，地址不同时新建勿复用旧 host",
			DefaultEnabled: true,
		},
		{
			Name: "list_ssh_forward_presets", Label: "列出端口转发预设", Risk: RiskRead,
			Description:    "已保存的 SSH 本地端口转发",
			DefaultEnabled: true,
		},
		{
			Name: "save_ssh_forward", Label: "保存端口转发资产", Risk: RiskWrite,
			Description:    "写入可复现的端口转发预设并刷新终端侧栏",
			DefaultEnabled: true,
		},
		{
			Name: "list_connections", Label: "列出数据库连接", Risk: RiskRead,
			Description:    "已保存的 MySQL / PostgreSQL / Redis 连接（不含密码）",
			DefaultEnabled: true,
		},
		{
			Name: "save_connection", Label: "保存数据库连接资产", Risk: RiskWrite,
			Description:    "写入可复现的数据库连接并刷新界面；密码可空由用户补全",
			DefaultEnabled: true,
		},
		{
			Name: "shell_run", Label: "Shell 运行（可见）", Risk: RiskSession,
			Description:    "给人看的 Shell：注入 pip/下载/训练/脚本到可见 PTY；不返回 stdout，下一轮前馈才带新输出",
			DefaultEnabled: true,
		},
		{
			Name: "shell_probe", Label: "Shell 探针（只读）", Risk: RiskRead,
			Description:    "无头只读短探针（uptime/nvidia-smi/python -c print）；改机器必须 shell_run；看可见终端用 get_shell_output",
			DefaultEnabled: true,
		},
		{
			Name: "get_shell_output", Label: "读取终端输出", Risk: RiskRead,
			Description:    "分页读取可见 PTY scrollback；offsetFromEnd=0 最新，nextOffsetFromEnd 向历史翻页",
			DefaultEnabled: true,
		},
		{
			Name: "database_open", Label: "打开数据库工作台", Risk: RiskSession,
			Description:    "切换到数据库并连接，可选填入或执行 SQL",
			DefaultEnabled: true,
		},
		{
			Name: "open_database_session", Label: "打开数据库会话", Risk: RiskSession,
			Description:    "按 connectionId 建立连接并返回 sessionId",
			DefaultEnabled: true,
		},
		{
			Name: "close_database_session", Label: "关闭数据库会话", Risk: RiskSession,
			Description:    "释放指定 sessionId 的连接",
			DefaultEnabled: true,
		},
		{
			Name: "list_tables", Label: "列出表与视图", Risk: RiskRead,
			Description:    "指定库下的表、视图名称",
			DefaultEnabled: true,
		},
		{
			Name: "describe_table", Label: "查看表结构", Risk: RiskRead,
			Description:    "列名、类型、主键等元数据",
			DefaultEnabled: true,
		},
		{
			Name: "execute_sql", Label: "执行 SQL", Risk: RiskWrite,
			Description:  "readonly=true 时仅 SELECT/SHOW/EXPLAIN 等；写入类 SQL 需用户弹窗确认",
			NeedsConfirm: true, DefaultEnabled: true,
		},
		{
			Name: "notebook_append_content", Label: "写入笔记本", Risk: RiskWrite,
			Description:    "写入笔记本（按标题定位或新建，不要默认当前打开的草稿）",
			DefaultEnabled: true,
		},
		{
			Name: "list_notes", Label: "列出笔记", Risk: RiskRead,
			Description:    "笔记本标题、id、分组（无正文）。读某篇用 get_note(noteId)",
			DefaultEnabled: true,
		},
		{
			Name: "search_notes", Label: "搜索笔记", Risk: RiskRead,
			Description:    "按标题或正文关键词搜笔记摘要；再 get_note(noteId) 取全文。禁止用 recall_resource 当笔记",
			DefaultEnabled: true,
		},
		{
			Name: "get_note", Label: "读取笔记正文", Risk: RiskRead,
			Description:    "按 noteId 返回 Markdown 全文。当前打开的笔记 id 在本轮工作台现状里。笔记在工作台库内，禁止 cat 文件",
			DefaultEnabled: true,
		},
		{
			Name: "list_docker_contexts", Label: "列出 Docker 上下文", Risk: RiskRead,
			Description:    "本地与 SSH 远端 Docker 上下文",
			DefaultEnabled: true,
		},
		{
			Name: "save_docker_context", Label: "保存 Docker 上下文资产", Risk: RiskWrite,
			Description:    "将 SSH 主机登记为 Docker 上下文并刷新界面",
			DefaultEnabled: true,
		},
		{
			Name: "list_containers", Label: "列出容器", Risk: RiskRead,
			Description:    "指定上下文下的容器列表（状态、镜像、端口）",
			DefaultEnabled: true,
		},
		{
			Name: "get_container_logs", Label: "读取容器日志", Risk: RiskRead,
			Description:    "容器 stdout/stderr 尾部，用于排错",
			DefaultEnabled: true,
		},
		{
			Name: "start_container", Label: "启动容器", Risk: RiskWrite,
			Description:  "启动已存在容器；执行前需用户确认",
			NeedsConfirm: true, DefaultEnabled: true,
		},
		{
			Name: "stop_container", Label: "停止容器", Risk: RiskWrite,
			Description:  "停止运行中容器；执行前需用户确认",
			NeedsConfirm: true, DefaultEnabled: true,
		},
		{
			Name: "remove_container", Label: "删除容器", Risk: RiskWrite,
			Description:  "强制删除容器；执行前需用户确认（勿用 shell_probe docker rm）",
			NeedsConfirm: true, DefaultEnabled: true,
		},
		{
			Name: "list_log_sources", Label: "列出日志源", Risk: RiskRead,
			Description:    "已保存的本机/SSH/Docker/Compose 日志源",
			DefaultEnabled: true,
		},
		{
			Name: "save_log_source", Label: "保存日志源资产", Risk: RiskWrite,
			Description:    "写入可复现的日志源并刷新界面；应先 save 再 fetch_logs",
			DefaultEnabled: true,
		},
		{
			Name: "fetch_logs", Label: "拉取日志", Risk: RiskRead,
			Description:    "按 logSourceId 读取日志尾部",
			DefaultEnabled: true,
		},
		{
			Name: "list_http_requests", Label: "列出 HTTP 请求", Risk: RiskRead,
			Description:    "已保存的 API 调试模板",
			DefaultEnabled: true,
		},
		{
			Name: "list_http_environments", Label: "列出 HTTP 环境", Risk: RiskRead,
			Description:    "环境变量预设（{{name}} 替换）",
			DefaultEnabled: true,
		},
		{
			Name: "save_http_environment", Label: "保存 HTTP 环境资产", Risk: RiskWrite,
			Description:    "写入环境变量预设；与 save_http_request / execute_http(envId) 配套",
			DefaultEnabled: true,
		},
		{
			Name: "save_http_request", Label: "保存 HTTP 请求资产", Risk: RiskWrite,
			Description:    "写入可复现的请求模板并刷新界面；调试应先 save 再 execute",
			DefaultEnabled: true,
		},
		{
			Name: "execute_http", Label: "执行 HTTP 请求", Risk: RiskWrite,
			Description:  "优先 requestId；GET/HEAD 直执；变更类方法需用户确认",
			NeedsConfirm: true, DefaultEnabled: true,
		},
		{
			Name: "logs_open", Label: "打开日志中心", Risk: RiskSession,
			Description:    "切换到日志产品线；可按 logSourceId 或 Docker/SSH 外键起草并拉取",
			DefaultEnabled: true,
		},
		{
			Name: "httpapi_open", Label: "打开 API 工作台", Risk: RiskSession,
			Description:    "切换到 HTTP API 产品线，可选聚焦已保存请求",
			DefaultEnabled: true,
		},
		{
			Name: "environment_open", Label: "打开环境工作台", Risk: RiskSession,
			Description:    "切换到本机环境产品线；可选 lang 打开版本切换或预设",
			DefaultEnabled: true,
		},
		{
			Name: "ssh_forward_open", Label: "打开 SSH 隧道", Risk: RiskSession,
			Description:    "切换到终端侧栏隧道；可按 hostId 新建或 presetId 编辑",
			DefaultEnabled: true,
		},
		{
			Name: "publish_agent_skill", Label: "发布技能", Risk: RiskWrite,
			Description:    "首次从笔记发布为 / 可调用的 Skill；须 noteId 写关联标记",
			DefaultEnabled: true,
		},
		{
			Name: "update_agent_skill", Label: "更新技能", Risk: RiskWrite,
			Description:    "更新已有 Skill 正文或元数据；不写笔记",
			DefaultEnabled: true,
		},
		{
			Name: "offer_choices", Label: "向用户提问选项", Risk: RiskRead,
			Description:    "展示可点选项并等待用户选择（拍板/选下一步）；调用后本轮暂停",
			DefaultEnabled: true,
		},
	}
}

// DefaultPermissions 默认工具开关。
func DefaultPermissions() map[string]bool {
	m := make(map[string]bool, len(Catalog()))
	for _, c := range Catalog() {
		m[c.Name] = c.DefaultEnabled
	}
	return m
}

// RiskOf 按工具名返回风险级别；未登记的记忆类工具视为只读。
func RiskOf(name string) Risk {
	name = strings.TrimSpace(name)
	for _, c := range Catalog() {
		if c.Name == name {
			return c.Risk
		}
	}
	return RiskRead
}

// UnavailableNote 尚未接入 Agent 的系统能力说明。
const UnavailableNote = "SFTP 文件操作尚未完全接入 AI；UI 打开类已齐：终端/库/笔记/SFTP/Docker/日志/API/环境；核心资产落盘：HTTP、SSH、库连接、日志源、Docker、环境预设；变更经 workbench-changed 雷达刷新界面。"

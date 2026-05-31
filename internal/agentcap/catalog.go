package agentcap

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
			Description: "当前产品线、数据库连接、SSH 主机、已开会话、最近 SQL 历史摘要（均无密码）",
			DefaultEnabled: true,
		},
		{
			Name: "list_connections", Label: "列出数据库连接", Risk: RiskRead,
			Description: "已保存的 MySQL / PostgreSQL / Redis 连接（不含密码）",
			DefaultEnabled: true,
		},
		{
			Name: "list_ssh_hosts", Label: "列出 SSH 主机", Risk: RiskRead,
			Description: "已保存的 SSH 主机配置（不含密码，用于终端/SFTP）",
			DefaultEnabled: true,
		},
		{
			Name: "terminal.open", Label: "打开终端", Risk: RiskSession,
			Description: "打开本机或 SSH 终端并可选注入命令；输出在终端面板由用户查看",
			DefaultEnabled: true,
		},
		{
			Name: "terminal.exec", Label: "执行 Shell 命令（只读）", Risk: RiskRead,
			Description: "无头执行单条诊断命令并返回输出（如 uptime、free -h、df -h）",
			DefaultEnabled: true,
		},
		{
			Name: "database.open", Label: "打开数据库工作台", Risk: RiskSession,
			Description: "切换到数据库并连接，可选填入或执行 SQL",
			DefaultEnabled: true,
		},
		{
			Name: "open_database_session", Label: "打开数据库会话", Risk: RiskSession,
			Description: "按 connectionId 建立连接并返回 sessionId",
			DefaultEnabled: true,
		},
		{
			Name: "close_database_session", Label: "关闭数据库会话", Risk: RiskSession,
			Description: "释放指定 sessionId 的连接",
			DefaultEnabled: true,
		},
		{
			Name: "list_tables", Label: "列出表与视图", Risk: RiskRead,
			Description: "指定库下的表、视图名称",
			DefaultEnabled: true,
		},
		{
			Name: "describe_table", Label: "查看表结构", Risk: RiskRead,
			Description: "列名、类型、主键等元数据",
			DefaultEnabled: true,
		},
		{
			Name: "execute_sql", Label: "执行 SQL", Risk: RiskWrite,
			Description: "readonly=true 时仅 SELECT/SHOW/EXPLAIN 等；写入类 SQL 需用户弹窗确认",
			NeedsConfirm: true, DefaultEnabled: true,
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

// UnavailableNote 尚未接入 Agent 的系统能力说明。
const UnavailableNote = "SFTP、Docker、环境管理、笔记本、HTTP API、日志中心尚未接入 AI；终端可用 terminal.open（面板可见）与 terminal.exec（返回输出）。"

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
	DefaultEnabled bool   `json:"defaultEnabled"`
}

// Catalog 当前 Agent 可注册的全部能力。
func Catalog() []Item {
	return []Item{
		{
			Name: "get_workbench_context", Label: "读取工作台上下文", Risk: RiskRead,
			Description:    "产品线/连接/SSH、打开中的终端列表（不含正文）、memoryNotes（焦点绑定记忆）",
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
			Name: "list_skills", Label: "列出工作流", Risk: RiskRead,
			Description:    "列出笔记本工作流（~/.wworkbench/notebook/工作流/）",
			DefaultEnabled: true,
		},
		{
			Name: "get_skill", Label: "读取工作流", Risk: RiskRead,
			Description:    "读取工作流正文与 diskPath；/ 挂载后首轮须调用",
			DefaultEnabled: true,
		},
		{
			Name: "run_skill", Label: "运行工作流", Risk: RiskWrite,
			Description:    "可选：机械逐步跑工作流步骤；主路径 get_skill 后 Agent 自己干，再 update_skill 沉淀",
			DefaultEnabled: true,
		},
		{
			Name: "read_file", Label: "读取项目文件", Risk: RiskRead,
			Description:    "读取 ningharness 项目内文本（相对根路径）",
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
			Name: "terminal_reconnect", Label: "终端重连", Risk: RiskSession,
			Description:    "重连已打开的本机/SSH/Docker 终端（保留面板历史）；可按 sessionId 或 hostId",
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
			DefaultEnabled: true,
		},
		{
			Name: "backup_open", Label: "打开备份工作台", Risk: RiskSession,
			Description:    "切换到备份产品线；可起草或聚焦策略",
			DefaultEnabled: true,
		},
		{
			Name: "list_backup_policies", Label: "列出备份策略", Risk: RiskRead,
			Description:    "files/sqlite/db 备份策略资产",
			DefaultEnabled: true,
		},
		{
			Name: "save_backup_policy", Label: "保存备份策略", Risk: RiskWrite,
			Description:    "统一备份策略（文件路径或数据库连接）；写前可强制",
			DefaultEnabled: true,
		},
		{
			Name: "run_backup", Label: "执行备份", Risk: RiskWrite,
			Description:    "按策略备份；需确认；写库前 beforeWrite 可自动触发",
			DefaultEnabled: true,
		},
		{
			Name: "list_backup_runs", Label: "列出备份记录", Risk: RiskRead,
			Description:    "备份执行历史（成功/失败/注入）",
			DefaultEnabled: true,
		},
		{
			Name: "host_health_scan", Label: "工作目录扫描", Risk: RiskRead,
			Description:    "在指定绝对目录扫描 *.db/.env/data；禁止全盘扫",
			DefaultEnabled: true,
		},
		{
			Name: "ensure_host_backup_policies", Label: "为所选创建备份", Risk: RiskWrite,
			Description:    "仅为用户勾选的 findingIds 创建策略；需确认；禁止默认全选",
			DefaultEnabled: true,
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
			Description:    "按 noteId 返回 Markdown 全文。当前打开的笔记 id 在界面快照里。笔记在工作台库内，禁止 cat 文件",
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
			DefaultEnabled: true,
		},
		{
			Name: "stop_container", Label: "停止容器", Risk: RiskWrite,
			Description:  "停止运行中容器；执行前需用户确认",
			DefaultEnabled: true,
		},
		{
			Name: "remove_container", Label: "删除容器", Risk: RiskWrite,
			Description:  "强制删除容器；执行前需用户确认（勿用 shell_probe docker rm）",
			DefaultEnabled: true,
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
			DefaultEnabled: true,
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
			Name: "browser_status", Label: "浏览器舞台状态", Risk: RiskRead,
			Description:    "桥监听/扩展是否已连接/扩展目录；动手前先查",
			DefaultEnabled: true,
		},
		{
			Name: "browser_list_tabs", Label: "列出浏览器标签", Risk: RiskRead,
			Description:    "Chromium 可操作标签（保留登录态）",
			DefaultEnabled: true,
		},
		{
			Name: "browser_attach", Label: "附着浏览器标签", Risk: RiskSession,
			Description:    "指定 tabId，后续快照/点击/填表作用于此页",
			DefaultEnabled: true,
		},
		{
			Name: "browser_find_tab", Label: "定位并附着标签", Risk: RiskSession,
			Description:    "按 url/host 或 active=true 附着；少一次 list→attach",
			DefaultEnabled: true,
		},
		{
			Name: "browser_snapshot", Label: "浏览器页面快照", Risk: RiskRead,
			Description:    "默认 aria 文本树；format=json 返回 nodes",
			DefaultEnabled: true,
		},
		{
			Name: "browser_find", Label: "浏览器查找节点", Risk: RiskRead,
			Description:    "按文案/角色子串查找 @e 节点",
			DefaultEnabled: true,
		},
		{
			Name: "browser_run", Label: "浏览器只读批跑", Risk: RiskRead,
			Description:    "steps 一次往返（snapshot/find/wait/evaluate…）",
			DefaultEnabled: true,
		},
		{
			Name: "browser_evaluate", Label: "页内执行 JS", Risk: RiskRead,
			Description:    "只读提取；建议 IIFE",
			DefaultEnabled: true,
		},
		{
			Name: "browser_read_page", Label: "读页面正文", Risk: RiskRead,
			Description:    "分页读 body 文本；complete/nextStart 续读",
			DefaultEnabled: true,
		},
		{
			Name: "browser_wait", Label: "浏览器等待", Risk: RiskRead,
			Description:    "等待文案/节点/readyState",
			DefaultEnabled: true,
		},
		{
			Name: "browser_upload", Label: "浏览器上传文件", Risk: RiskWrite,
			Description:    "CDP 设置 file input；须 intent；询问开时确认",
			DefaultEnabled: true,
		},
		{
			Name: "browser_network", Label: "浏览器网络捕获", Risk: RiskRead,
			Description:    "start/list/detail/stop；调试接口与登录失败",
			DefaultEnabled: true,
		},
		{
			Name: "browser_select_option", Label: "选择下拉项", Risk: RiskWrite,
			Description:    "原生/Ant/Element 下拉；询问开时确认",
			DefaultEnabled: true,
		},
		{
			Name: "browser_drag", Label: "浏览器拖拽", Risk: RiskWrite,
			Description:    "真指针拖放；询问开时确认",
			DefaultEnabled: true,
		},
		{
			Name: "browser_screenshot", Label: "浏览器截图", Risk: RiskRead,
			Description:    "截取附着标签可视区，返回本机 path",
			DefaultEnabled: true,
		},
		{
			Name: "browser_click", Label: "浏览器点击", Risk: RiskWrite,
			Description:    "点击 ref/selector（默认真指针）；须 intent；询问开时确认",
			DefaultEnabled: true,
		},
		{
			Name: "browser_keys", Label: "浏览器按键", Risk: RiskWrite,
			Description:    "发送 Enter/Escape/Mod+A 等；须 intent；询问开时确认",
			DefaultEnabled: true,
		},
		{
			Name: "browser_fill", Label: "浏览器填表", Risk: RiskWrite,
			Description:    "填写输入框；须 intent；询问开时确认",
			DefaultEnabled: true,
		},
		{
			Name: "browser_navigate", Label: "浏览器导航", Risk: RiskWrite,
			Description:    "打开 URL；须 intent；询问开时确认；优先附着已登录页",
			DefaultEnabled: true,
		},
		{
			Name: "browser_open_frame", Label: "打开跨域 iframe", Risk: RiskWrite,
			Description:    "将 #fN 以新标签打开并附着",
			DefaultEnabled: true,
		},
		{
			Name: "browser_close_session", Label: "关闭浏览器任务组", Risk: RiskSession,
			Description:    "关闭 session 标签组内 Agent 打开的页；借用标签保留",
			DefaultEnabled: true,
		},
		{
			Name: "browser_group_session", Label: "收纳到标签组", Risk: RiskSession,
			Description:    "按 url/tabIds 把已开标签收进彩色组（可见 group_title）",
			DefaultEnabled: true,
		},
		{
			Name: "browser_open", Label: "打开浏览器舞台", Risk: RiskSession,
			Description:    "切换到浏览器产品线",
			DefaultEnabled: true,
		},
		{
			Name: "list_task_runs", Label: "列出日志", Risk: RiskRead,
			Description:    "浏览器日志列表（可按 session 过滤），用于复盘",
			DefaultEnabled: true,
		},
		{
			Name: "get_task_run", Label: "日志详情", Risk: RiskRead,
			Description:    "一条日志的步骤时间线（含 locator / intent）",
			DefaultEnabled: true,
		},
		{
			Name: "replay_task_step", Label: "试跑日志一步", Risk: RiskWrite,
			Description:    "教练式：按 locator 重定位后执行/跳过一步，返回 nextSeq",
			DefaultEnabled: true,
		},
		{
			Name: "distill_workflow", Label: "生成工作流", Risk: RiskWrite,
			Description:    "从日志蒸馏工作流笔记（说明/步骤/脚本/资源；可 dropSeqs）",
			DefaultEnabled: true,
		},
		{
			Name: "list_workflows", Label: "列出工作流", Risk: RiskRead,
			Description:    "含步骤的工作流笔记 + 内置 cms_new_article",
			DefaultEnabled: true,
		},
		{
			Name: "get_workflow", Label: "工作流详情", Risk: RiskRead,
			Description:    "读取工作流步骤 locator/args",
			DefaultEnabled: true,
		},
		{
			Name: "save_workflow", Label: "保存工作流步骤", Risk: RiskWrite,
			Description:    "覆盖保存工作流笔记步骤（编辑后写回）",
			DefaultEnabled: true,
		},
		{
			Name: "update_skill", Label: "沉淀更新 Skill", Risk: RiskWrite,
			Description:    "把经验/优化步骤/脚本/资源写回工作流笔记；跑通或踩坑后应调用",
			DefaultEnabled: true,
		},
		{
			Name: "list_plugin_packs", Label: "列出插件包", Risk: RiskRead,
			Description:    "用户可写插件源码（~/.wworkbench/plugins），不是数据库连接",
			DefaultEnabled: true,
		},
		{
			Name: "get_plugin_pack", Label: "插件包详情", Risk: RiskRead,
			Description:    "源码/产物路径、ww-cap 兼容现状、是否已构建 UI",
			DefaultEnabled: true,
		},
		{
			Name: "get_plugin_protocol", Label: "读插件协议", Risk: RiskRead,
			Description:    "平台 Host↔Pack 协议 SSOT（PROTOCOL.md + ww-cap）；改任何 pack 前先读",
			DefaultEnabled: true,
		},
		{
			Name: "list_plugin_pack_files", Label: "列出插件源码文件", Risk: RiskRead,
			Description:    "相对 pack 根的文件列表",
			DefaultEnabled: true,
		},
		{
			Name: "read_plugin_pack_file", Label: "读插件源码", Risk: RiskRead,
			Description:    "按行分段读 plugins/<id> 文本；大文件用 startLine/maxLines 翻页；协议用 get_plugin_protocol",
			DefaultEnabled: true,
		},
		{
			Name: "edit_plugin_pack_file", Label: "局部编辑插件源码", Risk: RiskWrite,
			Description:    "oldString→newString 精确替换；大文件首选；需确认，之后再构建",
			DefaultEnabled: true,
		},
		{
			Name: "write_plugin_pack_file", Label: "整文件写插件源码", Risk: RiskWrite,
			Description:    "整文件覆盖；仅新建/大重写；局部改用 edit；需确认，之后再构建",
			DefaultEnabled: true,
		},
		{
			Name: "build_plugin_pack_ui", Label: "构建插件 UI", Risk: RiskWrite,
			Description:    "vite 构建到 run/<id>/ui，并自动打 release 快照；需确认",
			DefaultEnabled: true,
		},
		{
			Name: "list_plugin_pack_releases", Label: "列出插件版本", Risk: RiskRead,
			Description:    "查看 ~/.wworkbench/releases/<id> 历史快照，供回滚",
			DefaultEnabled: true,
		},
		{
			Name: "rollback_plugin_pack", Label: "回滚插件版本", Risk: RiskWrite,
			Description:    "恢复指定 release 的源码与 UI；需确认。回滚前会自动再打一版快照",
			DefaultEnabled: true,
		},
		{
			Name: "publish_agent_skill", Label: "标为工作流", Risk: RiskWrite,
			Description:    "笔记标 role=skill；真源仅笔记本 工作流/{name}/；优先传 noteId",
			DefaultEnabled: true,
		},
		{
			Name: "update_agent_skill", Label: "更新工作流投影（已废弃）", Risk: RiskWrite,
			Description:    "已废弃 system/skills 投影；请用 update_skill 写笔记本",
			DefaultEnabled: false,
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

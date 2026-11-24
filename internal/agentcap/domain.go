package agentcap

import "strings"

// Domain 工具所属产品域（用于权限分组与默认精简）。
type Domain string

const (
	DomainCore     Domain = "core"
	DomainTerminal Domain = "terminal"
	DomainCloud    Domain = "cloud"
	DomainDatabase Domain = "database"
	DomainNotebook    Domain = "notebook"
	DomainSkillMarket Domain = "skillmarket"
	DomainProject     Domain = "project"
	DomainBrowser  Domain = "browser"
	DomainDesktop  Domain = "desktop"
	DomainDocker   Domain = "docker"
	DomainBackup   Domain = "backup"
	DomainHTTP     Domain = "http"
	DomainLogs     Domain = "logs"
	DomainPlugin   Domain = "plugin"
	DomainEnv      Domain = "environment"
	DomainOther    Domain = "other"
)

// DomainOf 按工具名归域（注意力收敛：重域默认关）。
func DomainOf(name string) Domain {
	n := strings.TrimSpace(name)
	switch {
	case n == "get_workbench_context", n == "recall_resource", n == "search_session",
		n == "offer_choices", n == "get_agent_rules", n == "agent_chat", n == "agent_confirm",
		n == "get_task_summary":
		return DomainCore
	case strings.HasPrefix(n, "browser_"), n == "task_record", n == "list_task_runs",
		n == "get_task_run", n == "replay_task_step", n == "list_mcp_logs", n == "get_mcp_log":
		return DomainBrowser
	case strings.HasPrefix(n, "desktop_"):
		return DomainDesktop
	case strings.Contains(n, "plugin_pack"), n == "get_plugin_protocol":
		return DomainPlugin
	case strings.HasPrefix(n, "shell_"), strings.HasPrefix(n, "terminal_"),
		n == "get_shell_output", strings.HasPrefix(n, "list_ssh"), strings.HasPrefix(n, "save_ssh"),
		n == "ssh_forward_open", strings.HasPrefix(n, "list_ssh_forward"), strings.HasPrefix(n, "save_ssh_forward"):
		return DomainTerminal
	case n == "get_ecs_monitor", n == "sync_ssh_security_group", n == "configure_ssh_sg_sync":
		return DomainCloud
	case strings.Contains(n, "database"), n == "execute_sql", n == "list_tables", n == "describe_table",
		n == "list_connections", n == "save_connection", n == "open_database_session", n == "close_database_session":
		return DomainDatabase
	case n == "skillmarket_open", strings.Contains(n, "skill_market"), n == "list_skill_shelf",
		n == "publish_skill_market", n == "install_skill_market":
		return DomainSkillMarket
	case strings.Contains(n, "skill"), strings.Contains(n, "dir_version"), n == "list_notes",
		n == "get_note", n == "search_notes", n == "notebook_append_content", n == "publish_agent_skill",
		n == "run_skill", n == "distill_skill":
		return DomainNotebook
	case strings.Contains(n, "project"), strings.Contains(n, "cursor_transcript"),
		n == "ensure_cursor_stage_rule", n == "offer_episode_close", n == "close_learning_episode",
		strings.Contains(n, "episode"):
		return DomainProject
	case strings.Contains(n, "container"), strings.Contains(n, "docker"):
		return DomainDocker
	case strings.Contains(n, "backup"), n == "host_health_scan", n == "ensure_host_backup_policies":
		return DomainBackup
	case strings.Contains(n, "http"), n == "httpapi_open":
		return DomainHTTP
	case strings.Contains(n, "log"), n == "logs_open", n == "fetch_logs":
		return DomainLogs
	case n == "environment_open", strings.Contains(n, "environment"):
		return DomainEnv
	default:
		return DomainOther
	}
}

// RecommendedDefault 默认是否对 Agent/MCP 暴露（精简注意力；人可在能力权限里打开）。
func RecommendedDefault(name string) bool {
	switch DomainOf(name) {
	case DomainBrowser, DomainDesktop, DomainPlugin:
		return false
	case DomainSkillMarket:
		// 打开/只读列表默认开；上架与安装需登录且写风险，默认关。
		switch name {
		case "publish_skill_market", "install_skill_market":
			return false
		default:
			return true
		}
	case DomainDocker:
		// 列表只读开；启停删默认关
		switch name {
		case "start_container", "stop_container", "remove_container", "save_docker_context":
			return false
		default:
			return true
		}
	case DomainBackup:
		switch name {
		case "run_backup", "ensure_host_backup_policies", "save_backup_policy":
			return false
		default:
			return true
		}
	case DomainHTTP:
		switch name {
		case "execute_http", "save_http_request", "save_http_environment":
			return false
		default:
			return true
		}
	case DomainLogs:
		switch name {
		case "save_log_source", "fetch_logs":
			return false
		default:
			return true
		}
	case DomainDatabase:
		// 查连接/开库开；执行 SQL 默认关（写风险高，需要时再开）
		if name == "execute_sql" || name == "save_connection" {
			return false
		}
		return true
	default:
		return true
	}
}

// DomainLabel 域中文名（设置页分组）。
func DomainLabel(d Domain) string {
	switch d {
	case DomainCore:
		return "核心"
	case DomainTerminal:
		return "终端"
	case DomainCloud:
		return "云运维"
	case DomainDatabase:
		return "数据库"
	case DomainNotebook:
		return "笔记 / Skill"
	case DomainSkillMarket:
		return "技能市场"
	case DomainProject:
		return "项目"
	case DomainBrowser:
		return "浏览器 / 任务"
	case DomainDesktop:
		return "桌面应用"
	case DomainDocker:
		return "容器"
	case DomainBackup:
		return "备份"
	case DomainHTTP:
		return "HTTP API"
	case DomainLogs:
		return "日志"
	case DomainEnv:
		return "环境"
	case DomainPlugin:
		return "插件"
	default:
		return "其他"
	}
}

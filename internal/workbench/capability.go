package workbench

// 工作台统一能力 ID（与前端 workbench/capabilities.ts、agentcap.Catalog、workbenchtools 注册名保持一致）。
// 名称须匹配 ^[a-zA-Z0-9_-]+$（OpenAI / DeepSeek function calling）。
//
// 约定：
//   - 本文件是「能力名」的唯一常量源；风险/开关在 agentcap，handler 在 workbenchtools。
//   - UICapabilities 列出的能力由前端 CommandBus 执行（可先切产品线再挂载 handler）。

const (
	CapGetWorkbenchContext  = "get_workbench_context"
	CapListConnections      = "list_connections"
	CapListSSHHosts         = "list_ssh_hosts"
	CapShellRun             = "shell_run"
	CapShellProbe           = "shell_probe"
	CapGetShellOutput       = "get_shell_output"
	CapOpenDatabaseSession  = "open_database_session"
	CapCloseDatabaseSession = "close_database_session"
	CapListTables           = "list_tables"
	CapDescribeTable        = "describe_table"
	CapExecuteSQL           = "execute_sql"
	CapDatabaseOpen         = "database_open"
	CapNotebookOpen         = "notebook_open"
	CapNotebookAppend       = "notebook_append_content"
	CapListNotes            = "list_notes"
	CapSearchNotes          = "search_notes"
	CapGetNote              = "get_note"
	CapSFTPOpen             = "sftp_open"
	CapDockerContextOpen    = "docker_context_open"
	CapLogsOpen             = "logs_open"
	CapHTTPAPIOpen          = "httpapi_open"
	CapEnvironmentOpen      = "environment_open"
	CapSSHForwardOpen       = "ssh_forward_open"
	CapPublishAgentSkill    = "publish_agent_skill"
	CapAgentChat            = "agent_chat"
	CapAgentConfirm         = "agent_confirm"
)

// UICapabilities 需前端执行的 UI 联动能力（切产品线 + CommandBus handler）。
func UICapabilities() []string {
	return []string{
		CapShellRun,
		CapDatabaseOpen,
		CapNotebookOpen,
		CapSFTPOpen,
		CapDockerContextOpen,
		CapLogsOpen,
		CapHTTPAPIOpen,
		CapEnvironmentOpen,
		CapSSHForwardOpen,
	}
}

// IsUICapability 是否为前端 UI 联动能力。
func IsUICapability(name string) bool {
	for _, c := range UICapabilities() {
		if c == name {
			return true
		}
	}
	return false
}

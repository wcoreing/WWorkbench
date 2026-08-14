package workbench

// 工作台统一能力 ID（与前端 workbench/capabilities.ts、UIActionKind 保持一致）。
// 名称须匹配 ^[a-zA-Z0-9_-]+$（OpenAI / DeepSeek function calling）。

const (
	CapGetWorkbenchContext  = "get_workbench_context"
	CapListConnections      = "list_connections"
	CapListSSHHosts         = "list_ssh_hosts"
	CapOpenTerminal         = "terminal_open"
	CapTerminalExec         = "terminal_exec"
	CapOpenDatabaseSession  = "open_database_session"
	CapCloseDatabaseSession = "close_database_session"
	CapListTables           = "list_tables"
	CapDescribeTable        = "describe_table"
	CapExecuteSQL           = "execute_sql"
	CapDatabaseOpen         = "database_open"
	CapNotebookOpen         = "notebook_open"
	CapNotebookAppend       = "notebook_append_content"
	CapSFTPOpen             = "sftp_open"
	CapDockerContextOpen    = "docker_context_open"
)

// UICapabilities 需前端执行的 UI 联动能力。
func UICapabilities() []string {
	return []string{
		CapOpenTerminal,
		CapDatabaseOpen,
		CapNotebookOpen,
		CapSFTPOpen,
		CapDockerContextOpen,
	}
}

package workbench

// 工作台统一能力 ID（与前端 workbench/capabilities.ts、UIActionKind 保持一致）。

const (
	CapGetWorkbenchContext  = "get_workbench_context"
	CapListConnections      = "list_connections"
	CapListSSHHosts         = "list_ssh_hosts"
	CapOpenTerminal         = "terminal.open"
	CapTerminalExec         = "terminal.exec"
	CapOpenDatabaseSession  = "database.session.open"
	CapCloseDatabaseSession = "database.session.close"
	CapListTables           = "list_tables"
	CapDescribeTable        = "describe_table"
	CapExecuteSQL           = "database.sql.execute"
	CapDatabaseOpen         = "database.open"
	CapNotebookOpen         = "notebook.open"
	CapSFTPOpen             = "sftp.open"
	CapDockerContextOpen    = "docker.context.open"
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

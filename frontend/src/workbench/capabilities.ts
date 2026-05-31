/** 工作台统一能力 ID（与 Go internal/workbench/capability.go 保持一致）。 */

export const Capability = {
  GetWorkbenchContext: 'get_workbench_context',
  ListConnections: 'list_connections',
  ListSSHHosts: 'list_ssh_hosts',
  TerminalOpen: 'terminal.open',
  TerminalExec: 'terminal.exec',
  DatabaseSessionOpen: 'database.session.open',
  DatabaseSessionClose: 'database.session.close',
  ListTables: 'list_tables',
  DescribeTable: 'describe_table',
  DatabaseSqlExecute: 'database.sql.execute',
  DatabaseOpen: 'database.open',
  NotebookOpen: 'notebook.open',
  SftpOpen: 'sftp.open',
  DockerContextOpen: 'docker.context.open',
} as const

export type WorkbenchCapability = (typeof Capability)[keyof typeof Capability]

/** UI 联动能力（由 CommandBus 在前端执行）。 */
export const UI_CAPABILITIES: ReadonlySet<string> = new Set([
  Capability.TerminalOpen,
  Capability.DatabaseOpen,
  Capability.NotebookOpen,
  Capability.SftpOpen,
  Capability.DockerContextOpen,
])

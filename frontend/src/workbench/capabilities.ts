/** 工作台统一能力 ID（与 Go internal/workbench/capability.go 保持一致）。
 * 名称须匹配 ^[a-zA-Z0-9_-]+$（OpenAI / DeepSeek function calling）。
 */

export const Capability = {
  GetWorkbenchContext: 'get_workbench_context',
  ListConnections: 'list_connections',
  ListSSHHosts: 'list_ssh_hosts',
  TerminalOpen: 'terminal_open',
  TerminalExec: 'terminal_exec',
  DatabaseSessionOpen: 'open_database_session',
  DatabaseSessionClose: 'close_database_session',
  ListTables: 'list_tables',
  DescribeTable: 'describe_table',
  DatabaseSqlExecute: 'execute_sql',
  DatabaseOpen: 'database_open',
  NotebookOpen: 'notebook_open',
  NotebookAppend: 'notebook_append_content',
  SftpOpen: 'sftp_open',
  DockerContextOpen: 'docker_context_open',
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

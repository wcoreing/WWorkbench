/** 工作台统一能力 ID（与 Go internal/workbench/capability.go 保持一致）。
 * 名称须匹配 ^[a-zA-Z0-9_-]+$（OpenAI / DeepSeek function calling）。
 *
 * 本文件是前端能力名唯一源；跨产品跳转请用 assetOpen / openCapability，勿再发明 action 别名。
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
  ListNotes: 'list_notes',
  SearchNotes: 'search_notes',
  GetNote: 'get_note',
  SftpOpen: 'sftp_open',
  DockerContextOpen: 'docker_context_open',
  LogsOpen: 'logs_open',
  HttpApiOpen: 'httpapi_open',
  EnvironmentOpen: 'environment_open',
  SSHForwardOpen: 'ssh_forward_open',
  PublishAgentSkill: 'publish_agent_skill',
} as const

export type WorkbenchCapability = (typeof Capability)[keyof typeof Capability]

/** UI 联动能力（由 CommandBus 在前端执行）。 */
export const UI_CAPABILITIES: ReadonlySet<string> = new Set([
  Capability.TerminalOpen,
  Capability.DatabaseOpen,
  Capability.NotebookOpen,
  Capability.SftpOpen,
  Capability.DockerContextOpen,
  Capability.LogsOpen,
  Capability.HttpApiOpen,
  Capability.EnvironmentOpen,
  Capability.SSHForwardOpen,
])

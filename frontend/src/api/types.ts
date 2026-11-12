export interface AppError {
  code: string
  message: string
  detail?: string
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: AppError
}

export interface Connection {
  id: string
  name: string
  group: string
  dbType: string
  host: string
  port: number
  user: string
  password: string
  database: string
  charset: string
  sshEnabled: boolean
  sshHostId: string
  sshHost: string
  sshPort: number
  sshUser: string
  sshKeyPath: string
  sshPassword: string
  createdAt: number
  updatedAt: number
}

export interface SessionInfo {
  sessionId: string
  connectionId: string
  database: string
}

export interface ObjectTreeNode {
  id: string
  label: string
  nodeType: string
  database?: string
  table?: string
  children?: ObjectTreeNode[]
  lazy?: boolean
}

export interface ColumnMeta {
  name: string
  dataType: string
  columnType: string
  nullable: boolean
  isPrimaryKey: boolean
  extra?: string
  defaultValue?: string
  comment: string
  editable: boolean
}

export interface CellValue {
  value?: string
  isNull: boolean
  display: string
}

export interface QueryRow {
  cells: CellValue[]
}

export interface QueryPage {
  columns: ColumnMeta[]
  rows: QueryRow[]
  page: number
  pageSize: number
  total: number
  elapsedMs: number
}

export interface ExecuteResult {
  rowsAffected: number
  lastInsertId: number
  message: string
  elapsedMs: number
}

export interface SQLBatchItem {
  sql: string
  query?: QueryPage
  execute?: ExecuteResult
  error?: string
}

export interface SQLBatchResult {
  items: SQLBatchItem[]
}

export interface IndexMeta {
  name: string
  column: string
  nonUnique: boolean
  seqInIndex: number
  indexType: string
}

export interface TableRow {
  rowId: string
  values: Record<string, CellValue>
}

export interface TableFilter {
  enabled: boolean
  column: string
  operator: string
  value: string
}

export interface TableSort {
  column: string
  ascending: boolean
}

export interface TableDataQuery {
  page: number
  pageSize: number
  filters: TableFilter[]
  sorts: TableSort[]
}

export interface TableDataPage {
  columns: ColumnMeta[]
  rows: TableRow[]
  page: number
  pageSize: number
  total: number
  hasPrimaryKey: boolean
  readOnly: boolean
  elapsedMs: number
}

export interface FieldValue {
  name: string
  value?: string
  isNull: boolean
}

export interface RowMutation {
  rowId: string
  fields: FieldValue[]
  oldPk?: FieldValue[]
}

export interface RowMutationBatch {
  inserts: RowMutation[]
  updates: RowMutation[]
  deletes: RowMutation[]
}

export interface QueryHistory {
  id: string
  connectionId: string
  database: string
  sql: string
  executedAt: number
  elapsedMs: number
  success: boolean
}

export interface SSHHost {
  id: string
  name: string
  host: string
  port: number
  user: string
  password: string
  keyPath: string
  /** 库中是否已存密码（不回传明文） */
  hasPassword?: boolean
  /** 保存时显式清空已存密码 */
  clearPassword?: boolean
  /** 阿里云账号 ID；空表示不绑 ECS 监控 */
  cloudAccountId?: string
  cloudRegion?: string
  cloudInstanceId?: string
  /** 保存时覆盖云监控绑定；不传则后端保留原绑定 */
  touchCloud?: boolean
  createdAt: number
  updatedAt: number
}

/** CloudAccount 阿里云账号。密钥只在写入时提交。 */
export interface CloudAccount {
  id: string
  name: string
  provider: string
  accessKeyId: string
  accessKeySecret?: string
  hasSecret?: boolean
  createdAt: number
  updatedAt: number
}

/** ECSMetricPoint 云监控采样点。 */
export interface ECSMetricPoint {
  timestamp: number
  value: number
}

/** ECSMetricSeries 一条 ECS 指标。 */
export interface ECSMetricSeries {
  metric: string
  unit: string
  latest: number
  points?: ECSMetricPoint[]
  error?: string
}

/** ECSInstance 可绑定的阿里云 ECS。 */
export interface ECSInstance {
  instanceId: string
  name: string
  status: string
  publicIp: string
  privateIp: string
}

/** ECSMonitor 一台 ECS 最近一小时的云监控。 */
export interface ECSMonitor {
  instanceId: string
  region: string
  fetchedAt: number
  series?: ECSMetricSeries[]
  hint?: string
}

/** ShellHost 统一主机（SSH 或已注册 Docker 容器）。 */
export interface ShellHost {
  id: string
  kind: 'ssh' | 'docker'
  name: string
  host?: string
  port?: number
  user?: string
  password?: string
  keyPath?: string
  contextId?: string
  containerId?: string
  containerName?: string
  image?: string
  /** Docker：容器是否在运行；SSH 恒为 true */
  running?: boolean
  cloudAccountId?: string
  cloudRegion?: string
  cloudInstanceId?: string
  createdAt: number
  updatedAt: number
}

/** shellHostAsSSH 将 SSH 类 ShellHost 转为 SSHHost（供转发等复用）。 */
export function shellHostAsSSH(h: ShellHost): SSHHost | null {
  if (h.kind !== 'ssh') return null
  return {
    id: h.id,
    name: h.name,
    host: h.host || '',
    port: h.port || 22,
    user: h.user || '',
    password: h.password || '',
    keyPath: h.keyPath || '',
    cloudAccountId: h.cloudAccountId || '',
    cloudRegion: h.cloudRegion || '',
    cloudInstanceId: h.cloudInstanceId || '',
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  }
}

export interface SSHForwardPreset {
  id: string
  name: string
  sshHostId: string
  localPort: number
  remoteHost: string
  remotePort: number
  createdAt: number
  updatedAt: number
}

export interface SSHForwardStart {
  presetId?: string
  name?: string
  sshHostId?: string
  localPort?: number
  remoteHost?: string
  remotePort?: number
}

export interface SSHForwardActive {
  id: string
  presetId: string
  name: string
  sshHostId: string
  sshHostName: string
  localHost: string
  localPort: number
  localAddr: string
  remoteHost: string
  remotePort: number
  startedAt: number
}

/** LocalPortProcess 本机端口占用进程。 */
export interface LocalPortProcess {
  pid: number
  port: number
  name: string
  command: string
  user: string
  address: string
}

/** LocalPortKillResult 按端口结束进程结果。 */
export interface LocalPortKillResult {
  port: number
  force: boolean
  killed: LocalPortProcess[]
}

export interface TerminalSessionInfo {
  sessionId: string
  hostId: string
  title: string
  kind: 'local' | 'ssh' | 'docker'
  /** 命中主机级 SSH 热连接 */
  reused?: boolean
  /** 取得连接耗时（毫秒） */
  dialMs?: number
}

export interface SFTPSessionInfo {
  sessionId: string
  hostId: string
  title: string
  reused?: boolean
  dialMs?: number
}

export interface SFTPTextFile {
  path: string
  name: string
  content: string
  size: number
  encoding: string
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modTime: number
}

export interface LocalDirResult {
  path: string
  entries: FileEntry[]
}

export interface SftpBookmark {
  id: string
  side: 'local' | 'remote'
  hostId: string
  name: string
  path: string
  createdAt: number
}

export interface TransferConflict {
  hasConflict: boolean
  name: string
  sourcePath: string
  sourceSize: number
  sourceModTime: number
  sourceIsDir: boolean
  targetPath: string
  targetSize: number
  targetModTime: number
  targetIsDir: boolean
}

export interface DockerContext {
  id: string
  name: string
  kind: string
  endpoint: string
  sshHostId?: string
  connected: boolean
}

export interface DockerImage {
  id: string
  shortId: string
  tags: string
  size: number
  createdAt: number
}

export interface ContainerShell {
  mode: string
  hostId?: string
  contextId?: string
  containerId?: string
  command?: string
}

export interface ContainerDatabaseLink {
  dbType: string
  name: string
  host: string
  port: number
  user: string
  password?: string
  database?: string
  sshEnabled: boolean
  sshHostId: string
}

export interface ContainerEnvVar {
  key: string
  value: string
  highlight: boolean
}

export interface ContainerEnv {
  vars: ContainerEnvVar[]
}

export interface ContainerPortMapping {
  hostPort: number
  containerPort: number
  protocol: string
}

export interface ContainerMount {
  type: string
  name: string
  source: string
  destination: string
  mode: string
  rw: boolean
}

export interface HTTPHeaderKV {
  key: string
  value: string
}

export type BackupKind = 'files' | 'sqlite' | 'db'

export interface BackupPolicy {
  id: string
  name: string
  kind: BackupKind
  sshHostId: string
  connectionId: string
  path: string
  destRoot: string
  beforeWrite: boolean
  /** >0：按天保留（优先）；对齐云盘快照「自定义时长」 */
  retainDays: number
  /** retainDays=0 且 >0：按份数配额（持续保留）；皆 0=不清理 */
  retainCount: number
  /** 五段 cron；空=不定时（仅手动/写前） */
  cronExpr: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface BackupRun {
  id: string
  policyId: string
  trigger: string
  status: string
  destPath: string
  detail: string
  intent: string
  createdAt: number
}

export interface TaskRun {
  id: string
  session: string
  title: string
  intent: string
  status: string
  source: string
  stepCount?: number
  startedAt: number
  endedAt?: number
}

export interface TaskStep {
  id: string
  runId: string
  seq: number
  /** thought | op */
  kind?: string
  /** wwb | kimi | agent | ui | record | mcp */
  provider?: string
  tool: string
  action: string
  intent: string
  summary: string
  argsJson?: string
  locator?: string
  result?: string
  ok: boolean
  error?: string
  approved: boolean
  createdAt: number
}

export interface TaskRunDetail {
  run: TaskRun
  steps: TaskStep[]
}

export interface WorkflowStep {
  action: string
  summary?: string
  intent?: string
  locator?: Record<string, unknown>
  args?: Record<string, unknown>
}

export interface Workflow {
  id: string
  name: string
  title: string
  description?: string
  intent?: string
  steps: WorkflowStep[]
  sourceRunId?: string
  /** 工作流笔记 id；有则编辑应打开笔记本 */
  noteId?: string
  /** note | builtin */
  source?: string
  createdAt: number
  updatedAt: number
}

export type HostHealthSeverity = 'ok' | 'warn' | 'critical'

export interface HostHealthFinding {
  id: string
  severity: HostHealthSeverity
  kind: string
  title: string
  detail: string
  suggestKind: string
  path: string
  connectionId: string
  fixable: boolean
}

export interface HostHealthReport {
  sshHostId: string
  workDir: string
  hostLabel: string
  scannedAt: number
  score: number
  summary: string
  diskBrief: string
  findings: HostHealthFinding[]
  policyCount: number
  coveredCount: number
  fixableCount: number
}

export interface EnsureHostBackupResult {
  created: BackupPolicy[]
  skipped: number
  report: HostHealthReport
}

/** 主机记忆册：记忆区/{主机名}/ */
export interface HostMemoryBook {
  sshHostId: string
  dirRel: string
  noteId: string
  created: boolean
}

/** 主机记忆册下的项目绑定：记忆区/{主机}/项目/{名}/ */
export interface HostProject {
  dirRel: string
  name: string
  sshHostId: string
  localPath: string
  remotePath: string
  noteId: string
  skillNoteId?: string
}

export type LogSourceType = 'local_file' | 'ssh_file' | 'docker' | 'compose'

export interface LogSource {
  id: string
  name: string
  sourceType: LogSourceType
  path: string
  sshHostId: string
  dockerContextId: string
  containerId: string
  composeDir: string
  composeService: string
  tailLines: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface LogFetchResult {
  content: string
}

export interface HTTPFolder {
  id: string
  name: string
  parentId: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface HTTPSavedRequest {
  id: string
  folderId: string
  name: string
  method: string
  url: string
  paramsJson: string
  headersJson: string
  cookiesJson: string
  body: string
  notes: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface HTTPEnvironment {
  id: string
  name: string
  varsJson: string
  createdAt: number
  updatedAt: number
}

export interface HTTPResponse {
  statusCode: number
  status: string
  headers: HTTPHeaderKV[]
  body: string
  elapsedMs: number
  truncated: boolean
  error: string
}

export interface ComposeService {
  name: string
  service: string
  image: string
  state: string
  status: string
  ports: string
  containerId: string
}

export interface DockerContainer {
  id: string
  shortId: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  portMappings?: ContainerPortMapping[]
  mounts?: ContainerMount[]
  createdAt: number
}

export type RuntimeLang = 'node' | 'go' | 'php' | 'java'

export interface RuntimeInfo {
  lang: RuntimeLang
  label: string
  version: string
  manager: string
  managerLabel: string
  binary: string
  available: boolean
  canInstall: boolean
  needsManager: boolean
  canInstallManager: boolean
}

export interface RuntimeVersion {
  version: string
  label?: string
  formula?: string
  installed: boolean
  active: boolean
}

export interface EnvPreset {
  id: string
  name: string
  active: boolean
  runtimes: Record<string, string>
}

export interface ProjectEnvHint {
  path: string
  hints: string[]
  suggested: Record<string, string>
}

export interface EnvApplyResult {
  warnings: string[]
}

/** 笔记文件类型：内置预设见 noteFileTypes；可自定义任意字符串。 */
export type NoteLanguage = string

export interface NotebookGroup {
  id: string
  name: string
  parentId: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** 笔记角色：普通 / 记忆 / 方法 / 剧本 */
export type NoteRole = 'note' | 'memory' | 'skill'

export interface Note {
  id: string
  groupId: string
  title: string
  content: string
  language: NoteLanguage
  role: NoteRole
  sshHostId: string
  connectionId: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface NoteSummary {
  id: string
  groupId: string
  title: string
  language: NoteLanguage
  role: NoteRole
  sshHostId: string
  connectionId: string
  sortOrder: number
  updatedAt: number
}

export interface NotebookUI {
  openTabIds: string[]
  activeTabId: string
}

export interface NotebookAsset {
  id: string
  noteId: string
  name: string
  mime: string
  url: string
  markdown: string
  isImage: boolean
  size: number
}

export interface NotebookAssetUpload {
  noteId: string
  name: string
  mime: string
  data: string
}

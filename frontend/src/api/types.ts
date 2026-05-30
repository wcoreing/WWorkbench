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
  createdAt: number
  updatedAt: number
}

export interface TerminalSessionInfo {
  sessionId: string
  hostId: string
  title: string
  kind: 'local' | 'ssh'
}

export interface SFTPSessionInfo {
  sessionId: string
  hostId: string
  title: string
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
  command: string
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

export type NoteLanguage = 'plaintext' | 'shell' | 'markdown'

export interface NotebookGroup {
  id: string
  name: string
  parentId: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  groupId: string
  title: string
  content: string
  language: NoteLanguage
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
  sshHostId: string
  connectionId: string
  sortOrder: number
  updatedAt: number
}

export interface NotebookUI {
  openTabIds: string[]
  activeTabId: string
}

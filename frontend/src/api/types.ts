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
  dbType: string
  host: string
  port: number
  user: string
  password: string
  database: string
  charset: string
  sshEnabled: boolean
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

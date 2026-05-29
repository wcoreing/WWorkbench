import type { ApiResult, Connection, SSHHost, TableDataPage, TableDataQuery, TableRow, TerminalSessionInfo } from './types'
import { ApiCallError } from './errors'
import { model } from '../../wailsjs/go/models'

// Wails 绑定在 generate 后可用
import {
  GetVersion,
  ListConnections,
  GetConnection,
  SaveConnection,
  DeleteConnection,
  TestConnection,
  OpenSession,
  CloseSession,
  GetObjectTree,
  ListColumns,
  GetTableDDL,
  ExecuteSQL,
  QuerySQLPage,
  GetTableDataPage,
  ApplyTableMutations,
  ListQueryHistory,
  ExportCSV,
  SetDatabase,
  ListSSHHosts,
  GetSSHHost,
  SaveSSHHost,
  DeleteSSHHost,
  TestSSHHost,
  TrustSSHHost,
  OpenTerminal,
  OpenLocalTerminal,
  CloseTerminal,
  WriteTerminal,
  ResizeTerminal,
} from '../../wailsjs/go/app/Service'

/** 兼容 Wails 返回的 plain object / 类实例字段名差异 */
function normalizeResult<T>(raw: unknown): ApiResult<T> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: { code: 'UNKNOWN', message: '后端无响应' } }
  }
  const r = raw as Record<string, unknown>
  return {
    ok: r.ok === true || r.Ok === true,
    data: (r.data ?? r.Data) as T | undefined,
    error: (r.error ?? r.Error) as ApiResult<T>['error'],
  }
}

export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  if (typeof window !== 'undefined' && !(window as Window & { go?: unknown }).go) {
    throw new Error('Wails 运行时未就绪，请使用 wails dev 启动应用')
  }
  const res = normalizeResult<T>(await promise)
  if (!res.ok || res.error) {
    const err = res.error
    throw new ApiCallError(
      extractErrorMessage(err),
      (err?.code as string) || 'UNKNOWN',
      err?.detail as string | undefined
    )
  }
  return res.data as T
}

export { ApiCallError } from './errors'

/** extractErrorMessage 从 Wails 错误对象提取文案。 */
function extractErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return '请求失败'
  }
  const e = err as Record<string, unknown>
  const msg = e.message ?? e.Message
  const detail = e.detail ?? e.Detail
  if (typeof msg === 'string' && msg) {
    if (typeof detail === 'string' && detail) {
      return `${msg}（${detail}）`
    }
    return msg
  }
  if (typeof detail === 'string' && detail) {
    return detail
  }
  return '请求失败'
}

/** toSSHHostDO 转为 Wails 绑定的 SSH 主机模型。 */
export function toSSHHostDO(h: SSHHost): model.SSHHostDO {
  return model.SSHHostDO.createFrom({
    id: h.id,
    name: h.name,
    host: h.host,
    port: h.port || 22,
    user: h.user,
    password: h.password,
    keyPath: h.keyPath,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  })
}

/** toConnectionDO 转为 Wails 绑定的模型实例。 */
export function toConnectionDO(c: Connection): model.ConnectionDO {
  return model.ConnectionDO.createFrom({
    id: c.id,
    name: c.name,
    dbType: c.dbType || 'mysql',
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    charset: c.charset || 'utf8mb4',
    sshEnabled: c.sshEnabled,
    sshHost: c.sshHost,
    sshPort: c.sshPort,
    sshUser: c.sshUser,
    sshKeyPath: c.sshKeyPath,
    sshPassword: c.sshPassword,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  })
}

function asArray<T>(data: T[] | null | undefined): T[] {
  return Array.isArray(data) ? data : []
}

/** normalizeTableDataPage 规范化表数据分页（兼容 Wails 缺省字段）。 */
function normalizeTableDataPage(raw: TableDataPage | null | undefined): TableDataPage {
  const rows = asArray(raw?.rows).map((r) => ({
    rowId: r?.rowId ?? '',
    values: r?.values && typeof r.values === 'object' ? r.values : {},
  })) as TableRow[]
  return {
    columns: asArray(raw?.columns),
    rows,
    page: raw?.page ?? 1,
    pageSize: raw?.pageSize ?? 100,
    total: raw?.total ?? -1,
    hasPrimaryKey: raw?.hasPrimaryKey ?? false,
    readOnly: raw?.readOnly ?? true,
    elapsedMs: raw?.elapsedMs ?? 0,
  }
}

export const api = {
  getVersion: async () => (await unwrap(GetVersion())).version,
  listConnections: async () => asArray(await unwrap(ListConnections())),
  getConnection: async (id: string) => unwrap(GetConnection(id)),
  saveConnection: (c: Connection) => unwrap(SaveConnection(toConnectionDO(c))),
  deleteConnection: (id: string) => unwrap(DeleteConnection(id)),
  testConnection: (c: Connection) => unwrap(TestConnection(toConnectionDO(c))),
  openSession: (connectionId: string, database: string) =>
    unwrap(OpenSession(connectionId, database)),
  closeSession: (sessionId: string) => unwrap(CloseSession(sessionId)),
  getObjectTree: async (sessionId: string) => asArray(await unwrap(GetObjectTree(sessionId))),
  listColumns: (sessionId: string, database: string, table: string) =>
    unwrap(ListColumns(sessionId, database, table)),
  getTableDDL: async (sessionId: string, database: string, table: string) =>
    (await unwrap(GetTableDDL(sessionId, database, table))).content,
  executeSQL: (sessionId: string, database: string, sql: string) =>
    unwrap(ExecuteSQL(sessionId, database, sql)),
  querySQLPage: (
    sessionId: string,
    database: string,
    sql: string,
    page: number,
    pageSize: number
  ) => unwrap(QuerySQLPage(sessionId, database, sql, page, pageSize)),
  getTableDataPage: async (sessionId: string, database: string, table: string, query: TableDataQuery) =>
    normalizeTableDataPage(
      await unwrap(
        GetTableDataPage(
          sessionId,
          database,
          table,
          new model.TableDataQueryDO({
            page: query.page,
            pageSize: query.pageSize,
            filters: query.filters.map(
              (f) =>
                new model.TableFilterDO({
                  enabled: f.enabled,
                  column: f.column,
                  operator: f.operator,
                  value: f.value,
                })
            ),
            sorts: query.sorts.map(
              (s) =>
                new model.TableSortDO({
                  column: s.column,
                  ascending: s.ascending,
                })
            ),
          })
        )
      )
    ),
  applyTableMutations: (
    sessionId: string,
    database: string,
    table: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch: any
  ) => unwrap(ApplyTableMutations(sessionId, database, table, batch)),
  listQueryHistory: async (connectionId: string, limit: number) =>
    asArray(await unwrap(ListQueryHistory(connectionId, limit))),
  exportCSV: async (req: Parameters<typeof ExportCSV>[0]) => (await unwrap(ExportCSV(req))).path,
  setDatabase: (sessionId: string, database: string) =>
    unwrap(SetDatabase(sessionId, database)),
  listSSHHosts: async () => asArray(await unwrap(ListSSHHosts())),
  getSSHHost: async (id: string) => unwrap(GetSSHHost(id)),
  saveSSHHost: (h: SSHHost) => unwrap(SaveSSHHost(toSSHHostDO(h))),
  deleteSSHHost: (id: string) => unwrap(DeleteSSHHost(id)),
  testSSHHost: (h: SSHHost) => unwrap(TestSSHHost(toSSHHostDO(h))),
  trustSSHHost: (host: string, port: number) => unwrap(TrustSSHHost(host, port)),
  openTerminal: (hostId: string, cols: number, rows: number) =>
    unwrap(OpenTerminal(hostId, cols, rows)),
  openLocalTerminal: (cols: number, rows: number) =>
    unwrap(OpenLocalTerminal(cols, rows)),
  closeTerminal: (sessionId: string) => unwrap(CloseTerminal(sessionId)),
  writeTerminal: (sessionId: string, data: string) => unwrap(WriteTerminal(sessionId, data)),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    unwrap(ResizeTerminal(sessionId, cols, rows)),
}

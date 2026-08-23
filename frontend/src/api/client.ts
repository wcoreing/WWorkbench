import type {
  ApiResult,
  ColumnMeta,
  Connection,
  FileEntry,
  LocalDirResult,
  LocalPortKillResult,
  LocalPortProcess,
  SSHHost,
  ShellHost,
  SftpBookmark,
  TransferConflict,
  SFTPSessionInfo,
  TableDataPage,
  TableDataQuery,
  TableRow,
  ObjectTreeNode,
  TerminalSessionInfo,
} from './types'
import { ApiCallError } from './errors'
import { normalizeHTTPFolder, normalizeHTTPSavedRequest } from './httpNormalize'
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
  ListDatabaseObjects,
  ListColumns,
  GetTableDDL,
  ListIndexes,
  ExecuteSQL,
  QuerySQLPage,
  GetTableDataPage,
  ApplyTableMutations,
  ListQueryHistory,
  ExportCSV,
  ExportExcel,
  ExportTableExcel,
  SetDatabase,
  ListSSHHosts,
  ListShellHosts,
  GetSSHHost,
  GetShellHost,
  EnsureDockerHost,
  RemoveDockerHost,
  PruneStoppedDockerHosts,
  SaveSSHHost,
  DeleteSSHHost,
  TestSSHHost,
  TrustSSHHost,
  OpenTerminal,
  OpenLocalTerminal,
  CloseTerminal,
  WriteTerminal,
  ResizeTerminal,
  OpenSFTPSession,
  CloseSFTPSession,
  GetSFTPHome,
  ListSFTPDir,
  ListLocalDir,
  DownloadSFTPFile,
  UploadSFTPFile,
  DeleteSFTPPath,
  TransferSFTPUpload,
  TransferSFTPDownload,
  MkdirSFTPRemote,
  RenameSFTPRemote,
  MkdirLocalPath,
  RenameLocalPath,
  DeleteLocalPath,
  ListSFTPBookmarks,
  SaveSFTPBookmark,
  DeleteSFTPBookmark,
  CheckSFTPUploadConflict,
  CheckSFTPDownloadConflict,
  CancelSFTPTask,
  ExportConnectionsToFile,
  ImportConnectionsFromFile,
  ExecuteSQLFile,
  CreateDatabase,
  ExportTableInsertSQL,
  ExportTableSQL,
  ExportDatabaseSQL,
  CancelSQLExport,
  EnsureSSHHostFromConnection,
  ListDockerContexts,
  SaveDockerContext,
  DeleteDockerContext,
  TestDockerContext,
  ListContainers,
  ListImages,
  StartContainer,
  StopContainer,
  RestartContainer,
  RemoveContainer,
  GetContainerLogs,
  GetContainerEnv,
  GetContainerRunPreset,
  GetContainerShell,
  ResolveContainerDatabaseLink,
  RunContainer,
  PickDockerComposeDirectory,
  GetDockerComposeDirectory,
  ListComposeServices,
  ComposeUp,
  ComposeDown,
  ComposePull,
  GetComposeLogs,
  ComposeRestart,
  ListSSHForwardPresets,
  SaveSSHForwardPreset,
  DeleteSSHForwardPreset,
  ListActiveSSHForwards,
  StartSSHForward,
  StopSSHForward,
  ListLocalPortProcesses,
  ListListeningLocalPorts,
  KillLocalPortProcesses,
  ListHTTPRequests,
  SaveHTTPRequest,
  MoveHTTPRequestToFolder,
  DeleteHTTPRequest,
  ExecuteHTTPRequest,
  ListHTTPFolders,
  SaveHTTPFolder,
  DeleteHTTPFolder,
  ApplyHTTPApiTreeLayout,
  BatchDeleteHTTP,
  ListHTTPEnvironments,
  SaveHTTPEnvironment,
  DeleteHTTPEnvironment,
  ListLogSources,
  SaveLogSource,
  DeleteLogSource,
  FetchLogSource,
  FetchLogSourceConfig,
  StartLogFollow,
  StopLogFollow,
  PickLogFilePath,
  AgentChat,
  AgentStop,
  AgentConfirm,
  AgentRewind,
  GetAgentSettings,
  SaveAgentSettings,
  SaveAgentAPIConfig,
  SaveAgentPermissions,
  GetMCPStatus,
  SaveMCPConfig,
  ListAgentCapabilities,
  ApplyAgentProviderPreset,
  TestAgentConnection,
  ListAgentMessages,
  ListAgentThreads,
  GetAgentThread,
  SetAgentThreadBindings,
  SetAgentThreadSkillIDs,
  ListAgentSkills,
  ListSkillsDir,
  ListEnabledAgentSkills,
  GetAgentSkill,
  GetAgentSkillFile,
  SetAgentSkillEnabled,
  SaveAgentSkill,
  SaveAgentSkillFile,
  CreateAgentSkill,
  DeleteAgentSkill,
  PublishAgentSkill,
  ListAppSettings,
  SetAppSetting,
  LoadWorkspace,
  SaveWorkspace,
  ListEnvRuntimes,
  ListEnvVersions,
  UseEnvVersion,
  InstallEnvVersion,
  InstallEnvManager,
  EnsureEnvVersion,
  UninstallEnvVersion,
  ListEnvPresets,
  SaveEnvPreset,
  DeleteEnvPreset,
  ApplyEnvPreset,
  ScanEnvProjects,
  PickEnvScanDirectory,
  GetEnvScanPath,
  ListNotebookGroups,
  SaveNotebookGroup,
  DeleteNotebookGroup,
  ApplyNotebookLayout,
  ListNotes,
  SearchNotes,
  GetNote,
  SaveNote,
  DeleteNote,
  DeleteNotes,
  GetNotebookUI,
  SaveNotebookUI,
  DuplicateNote,
  ExportNote,
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

type WailsWindow = Window & { go?: { app?: { Service?: unknown } } }

const WAILS_NOT_READY =
  'Wails 运行时未就绪。请用 `wails dev` 打开原生窗口，不要直接在浏览器打开 localhost:5173。'

/** isWailsReady 检查 Go 绑定是否已注入。 */
export function isWailsReady(): boolean {
  return Boolean((window as WailsWindow).go?.app?.Service)
}

/** waitForWails 等待原生绑定注入（HMR / 冷启动竞态）。 */
export async function waitForWails(timeoutMs = 4000): Promise<void> {
  if (isWailsReady()) return
  const start = Date.now()
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (isWailsReady()) {
        resolve()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new Error(WAILS_NOT_READY))
        return
      }
      window.setTimeout(tick, 50)
    }
    tick()
  })
}

/**
 * unwrap 在绑定就绪后调用 Go 方法。
 * 必须传入工厂函数，避免 `window.go` 未注入时同步 TypeError。
 */
export async function unwrap<T>(call: () => Promise<ApiResult<T>>): Promise<T> {
  await waitForWails()
  const res = normalizeResult<T>(await call())
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
    group: c.group || '',
    dbType: c.dbType || 'mysql',
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    charset: c.charset || 'utf8mb4',
    sshEnabled: c.sshEnabled,
    sshHostId: c.sshHostId || '',
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

/** normalizeColumnMeta 规范化列元数据（兼容 Wails 大小写字段）。 */
function normalizeColumnMeta(raw: unknown): ColumnMeta {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (a: string, b: string) => String(r[a] ?? r[b] ?? '')
  const bool = (a: string, b: string) => Boolean(r[a] ?? r[b] ?? false)
  const def = r.defaultValue ?? r.DefaultValue
  return {
    name: str('name', 'Name'),
    dataType: str('dataType', 'DataType'),
    columnType: str('columnType', 'ColumnType'),
    nullable: bool('nullable', 'Nullable'),
    isPrimaryKey: bool('isPrimaryKey', 'IsPrimaryKey'),
    extra: str('extra', 'Extra'),
    defaultValue: def == null ? undefined : String(def),
    comment: str('comment', 'Comment'),
    editable: bool('editable', 'Editable'),
  }
}

/** normalizeTableDataPage 规范化表数据分页（兼容 Wails 缺省字段）。 */
function normalizeTableDataPage(raw: TableDataPage | null | undefined): TableDataPage {
  const rows = asArray(raw?.rows).map((r) => ({
    rowId: r?.rowId ?? '',
    values: r?.values && typeof r.values === 'object' ? r.values : {},
  })) as TableRow[]
  return {
    columns: asArray(raw?.columns).map((c) => normalizeColumnMeta(c)),
    rows,
    page: raw?.page ?? 1,
    pageSize: raw?.pageSize ?? 100,
    total: raw?.total ?? -1,
    hasPrimaryKey: raw?.hasPrimaryKey ?? false,
    readOnly: raw?.readOnly ?? true,
    elapsedMs: raw?.elapsedMs ?? 0,
  }
}

function asFileEntries(data: FileEntry[] | null | undefined): FileEntry[] {
  return Array.isArray(data) ? data : []
}

/** normalizeLocalDir 规范化本地目录列表。 */
function normalizeLocalDir(raw: LocalDirResult | null | undefined): LocalDirResult {
  return {
    path: raw?.path ?? '',
    entries: asFileEntries(raw?.entries),
  }
}

export const api = {
  getVersion: async () => (await unwrap(() => GetVersion())).version,
  listConnections: async () => asArray(await unwrap(() => ListConnections())),
  getConnection: async (id: string) => unwrap(() => GetConnection(id)),
  saveConnection: (c: Connection) => unwrap(() => SaveConnection(toConnectionDO(c))),
  deleteConnection: (id: string) => unwrap(() => DeleteConnection(id)),
  testConnection: (c: Connection) => unwrap(() => TestConnection(toConnectionDO(c))),
  openSession: (connectionId: string, database: string) =>
    unwrap(() => OpenSession(connectionId, database)),
  closeSession: (sessionId: string) => unwrap(() => CloseSession(sessionId)),
  getObjectTree: async (sessionId: string) => asArray(await unwrap(() => GetObjectTree(sessionId))),
  listDatabaseObjects: async (sessionId: string, database: string) =>
    asArray(await unwrap(() => ListDatabaseObjects(sessionId, database))) as ObjectTreeNode[],
  listColumns: async (sessionId: string, database: string, table: string) =>
    asArray(await unwrap(() => ListColumns(sessionId, database, table))),
  listIndexes: async (sessionId: string, database: string, table: string) =>
    asArray(await unwrap(() => ListIndexes(sessionId, database, table))),
  getTableDDL: async (sessionId: string, database: string, table: string) =>
    (await unwrap(() => GetTableDDL(sessionId, database, table))).content,
  executeSQL: (sessionId: string, database: string, sql: string) =>
    unwrap(() => ExecuteSQL(sessionId, database, sql)),
  querySQLPage: (
    sessionId: string,
    database: string,
    sql: string,
    page: number,
    pageSize: number
  ) => unwrap(() => QuerySQLPage(sessionId, database, sql, page, pageSize)),
  getTableDataPage: async (sessionId: string, database: string, table: string, query: TableDataQuery) =>
    normalizeTableDataPage(
      await unwrap(() => GetTableDataPage(
          sessionId,
          database,
          table,
          new model.TableDataQueryDO({
            page: query.page,
            pageSize: query.pageSize,
            filters: query.filters.map((f) => ({
              enabled: f.enabled,
              column: f.column,
              operator: f.operator,
              value: f.value,
            })),
            sorts: query.sorts.map((s) => ({
              column: s.column,
              ascending: !!s.ascending,
            })),
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
  ) => unwrap(() => ApplyTableMutations(sessionId, database, table, batch)),
  listQueryHistory: async (connectionId: string, limit: number) =>
    asArray(await unwrap(() => ListQueryHistory(connectionId, limit))),
  exportCSV: async (req: Parameters<typeof ExportCSV>[0]) => (await unwrap(() => ExportCSV(req))).path,
  exportExcel: async (req: Parameters<typeof ExportExcel>[0]) => (await unwrap(() => ExportExcel(req))).path,
  exportTableExcel: async (
    sessionId: string,
    database: string,
    table: string,
    query: TableDataQuery,
    columns: string[] = [],
    maxRows = 10000
  ) =>
    (
      await unwrap(() => ExportTableExcel(
          sessionId,
          database,
          table,
          new model.TableDataQueryDO({
            page: query.page,
            pageSize: query.pageSize,
            filters: query.filters.map((f) => ({
              enabled: f.enabled,
              column: f.column,
              operator: f.operator,
              value: f.value,
            })),
            sorts: query.sorts.map((s) => ({
              column: s.column,
              ascending: !!s.ascending,
            })),
          }),
          maxRows,
          columns
        )
      )
    ).path,
  setDatabase: (sessionId: string, database: string) =>
    unwrap(() => SetDatabase(sessionId, database)),
  listSSHHosts: async () => asArray(await unwrap(() => ListSSHHosts())),
  listShellHosts: async (): Promise<ShellHost[]> => asArray(await unwrap(() => ListShellHosts())) as ShellHost[],
  getSSHHost: async (id: string) => unwrap(() => GetSSHHost(id)),
  getShellHost: async (id: string): Promise<ShellHost> => unwrap(() => GetShellHost(id)) as Promise<ShellHost>,
  ensureDockerHost: async (contextId: string, containerId: string): Promise<ShellHost> =>
    unwrap(() => EnsureDockerHost(contextId, containerId)) as Promise<ShellHost>,
  removeDockerHost: (id: string) => unwrap(() => RemoveDockerHost(id)),
  pruneStoppedDockerHosts: () => unwrap(() => PruneStoppedDockerHosts()),
  saveSSHHost: (h: SSHHost) => unwrap(() => SaveSSHHost(toSSHHostDO(h))),
  deleteSSHHost: (id: string) => unwrap(() => DeleteSSHHost(id)),
  testSSHHost: (h: SSHHost) => unwrap(() => TestSSHHost(toSSHHostDO(h))),
  trustSSHHost: (host: string, port: number) => unwrap(() => TrustSSHHost(host, port)),
  openTerminal: (hostId: string, cols: number, rows: number) =>
    unwrap(() => OpenTerminal(hostId, cols, rows)),
  openLocalTerminal: (cols: number, rows: number) =>
    unwrap(() => OpenLocalTerminal(cols, rows)),
  closeTerminal: (sessionId: string) => unwrap(() => CloseTerminal(sessionId)),
  writeTerminal: (sessionId: string, data: string) => unwrap(() => WriteTerminal(sessionId, data)),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    unwrap(() => ResizeTerminal(sessionId, cols, rows)),
  openSFTPSession: (hostId: string) => unwrap(() => OpenSFTPSession(hostId)) as Promise<SFTPSessionInfo>,
  closeSFTPSession: (sessionId: string) => unwrap(() => CloseSFTPSession(sessionId)),
  getSFTPHome: (sessionId: string) => unwrap(() => GetSFTPHome(sessionId)),
  listSFTPDir: async (sessionId: string, path: string) =>
    asFileEntries(await unwrap(() => ListSFTPDir(sessionId, path))),
  listLocalDir: async (path: string) => normalizeLocalDir(await unwrap(() => ListLocalDir(path))),
  downloadSFTPFile: (sessionId: string, remotePath: string) =>
    unwrap(() => DownloadSFTPFile(sessionId, remotePath)),
  uploadSFTPFile: (sessionId: string, remoteDir: string) =>
    unwrap(() => UploadSFTPFile(sessionId, remoteDir)),
  deleteSFTPPath: (sessionId: string, remotePath: string) =>
    unwrap(() => DeleteSFTPPath(sessionId, remotePath)),
  transferSFTPUpload: (sessionId: string, taskId: string, localPath: string, remoteDir: string) =>
    unwrap(() => TransferSFTPUpload(sessionId, taskId, localPath, remoteDir)),
  transferSFTPDownload: (sessionId: string, taskId: string, remotePath: string, localDir: string) =>
    unwrap(() => TransferSFTPDownload(sessionId, taskId, remotePath, localDir)),
  mkdirSFTPRemote: (sessionId: string, dir: string) => unwrap(() => MkdirSFTPRemote(sessionId, dir)),
  renameSFTPRemote: (sessionId: string, oldPath: string, newPath: string) =>
    unwrap(() => RenameSFTPRemote(sessionId, oldPath, newPath)),
  mkdirLocalPath: (dir: string) => unwrap(() => MkdirLocalPath(dir)),
  renameLocalPath: (oldPath: string, newPath: string) => unwrap(() => RenameLocalPath(oldPath, newPath)),
  deleteLocalPath: (target: string) => unwrap(() => DeleteLocalPath(target)),
  listSFTPBookmarks: async (side: string, hostId: string) =>
    asArray(await unwrap(() => ListSFTPBookmarks(side, hostId))) as SftpBookmark[],
  saveSFTPBookmark: (b: SftpBookmark) =>
    unwrap(() => SaveSFTPBookmark(
        model.SftpBookmarkDO.createFrom({
          id: b.id,
          side: b.side,
          hostId: b.hostId,
          name: b.name,
          path: b.path,
          createdAt: b.createdAt,
        })
      )
    ) as Promise<SftpBookmark>,
  deleteSFTPBookmark: (id: string) => unwrap(() => DeleteSFTPBookmark(id)),
  checkSFTPUploadConflict: (sessionId: string, localPath: string, remoteDir: string) =>
    unwrap(() => CheckSFTPUploadConflict(sessionId, localPath, remoteDir)) as Promise<TransferConflict>,
  checkSFTPDownloadConflict: (sessionId: string, remotePath: string, localDir: string) =>
    unwrap(() => CheckSFTPDownloadConflict(sessionId, remotePath, localDir)) as Promise<TransferConflict>,
  cancelSFTPTask: (taskId: string) => unwrap(() => CancelSFTPTask(taskId)),
  exportConnectionsToFile: async (includeSecrets: boolean) =>
    (await unwrap(() => ExportConnectionsToFile(includeSecrets))).path,
  importConnectionsFromFile: () => unwrap(() => ImportConnectionsFromFile()),
  executeSQLFile: (sessionId: string, database: string) =>
    unwrap(() => ExecuteSQLFile(sessionId, database)),
  createDatabase: (sessionId: string, name: string, charset: string, collation: string) =>
    unwrap(() => CreateDatabase(sessionId, name, charset, collation)),
  exportTableInsertSQL: async (sessionId: string, database: string, table: string, maxRows: number) =>
    (await unwrap(() => ExportTableInsertSQL(sessionId, database, table, maxRows))).path,
  exportTableSQL: async (sessionId: string, database: string, table: string, taskId: string, maxRows: number) =>
    (await unwrap(() => ExportTableSQL(sessionId, database, table, taskId, maxRows))).path,
  exportDatabaseSQL: async (sessionId: string, database: string, taskId: string, maxRows: number) =>
    (await unwrap(() => ExportDatabaseSQL(sessionId, database, taskId, maxRows))).path,
  cancelSQLExport: (taskId: string) => unwrap(() => CancelSQLExport(taskId)),
  ensureSSHHostFromConnection: async (connectionId: string) => unwrap(() => EnsureSSHHostFromConnection(connectionId)),
  listDockerContexts: async () => asArray(await unwrap(() => ListDockerContexts())),
  saveDockerContext: (ctx: model.DockerContextDO) => unwrap(() => SaveDockerContext(ctx)),
  deleteDockerContext: (id: string) => unwrap(() => DeleteDockerContext(id)),
  testDockerContext: (contextId: string) => unwrap(() => TestDockerContext(contextId)),
  listContainers: async (contextId: string) => asArray(await unwrap(() => ListContainers(contextId))),
  listImages: async (contextId: string) => asArray(await unwrap(() => ListImages(contextId))),
  startContainer: (contextId: string, containerId: string) => unwrap(() => StartContainer(contextId, containerId)),
  stopContainer: (contextId: string, containerId: string) => unwrap(() => StopContainer(contextId, containerId)),
  restartContainer: (contextId: string, containerId: string) => unwrap(() => RestartContainer(contextId, containerId)),
  removeContainer: (contextId: string, containerId: string) => unwrap(() => RemoveContainer(contextId, containerId)),
  getContainerLogs: async (contextId: string, containerId: string, tail: number) =>
    (await unwrap(() => GetContainerLogs(contextId, containerId, tail))).content,
  getContainerEnv: async (contextId: string, containerId: string) =>
    unwrap(() => GetContainerEnv(contextId, containerId)),
  getContainerRunPreset: async (image: string) => unwrap(() => GetContainerRunPreset(image)),
  runContainer: async (contextId: string, spec: model.ContainerRunDO) =>
    unwrap(() => RunContainer(contextId, spec)),
  getContainerShell: async (contextId: string, containerId: string) =>
    unwrap(() => GetContainerShell(contextId, containerId)),
  resolveContainerDatabaseLink: async (contextId: string, containerId: string) =>
    unwrap(() => ResolveContainerDatabaseLink(contextId, containerId)),
  pickDockerComposeDirectory: async (contextId: string) =>
    (await unwrap(() => PickDockerComposeDirectory(contextId))) ?? '',
  getDockerComposeDirectory: async (contextId: string) =>
    (await unwrap(() => GetDockerComposeDirectory(contextId))) ?? '',
  listComposeServices: async (contextId: string, projectDir: string) =>
    asArray(await unwrap(() => ListComposeServices(contextId, projectDir))),
  composeUp: async (contextId: string, projectDir: string) => unwrap(() => ComposeUp(contextId, projectDir)),
  composeDown: async (contextId: string, projectDir: string) => unwrap(() => ComposeDown(contextId, projectDir)),
  composePull: async (contextId: string, projectDir: string) => unwrap(() => ComposePull(contextId, projectDir)),
  getComposeLogs: async (contextId: string, projectDir: string, service: string, tail: number) =>
    (await unwrap(() => GetComposeLogs(contextId, projectDir, service, tail))).content,
  composeRestart: async (contextId: string, projectDir: string, service: string) =>
    unwrap(() => ComposeRestart(contextId, projectDir, service)),
  listSSHForwardPresets: async () => asArray(await unwrap(() => ListSSHForwardPresets())),
  saveSSHForwardPreset: (p: model.SSHForwardPresetDO) => unwrap(() => SaveSSHForwardPreset(p)),
  deleteSSHForwardPreset: (id: string) => unwrap(() => DeleteSSHForwardPreset(id)),
  listActiveSSHForwards: async () => asArray(await unwrap(() => ListActiveSSHForwards())),
  startSSHForward: async (req: model.SSHForwardStartDO) => unwrap(() => StartSSHForward(req)),
  stopSSHForward: (id: string) => unwrap(() => StopSSHForward(id)),
  listLocalPortProcesses: async (port: number) =>
    asArray(await unwrap(() => ListLocalPortProcesses(port))) as LocalPortProcess[],
  listListeningLocalPorts: async () =>
    asArray(await unwrap(() => ListListeningLocalPorts())) as LocalPortProcess[],
  killLocalPortProcesses: async (port: number, force: boolean) =>
    unwrap(() => KillLocalPortProcesses(port, force)) as Promise<LocalPortKillResult>,
  listHTTPRequests: async () =>
    asArray(await unwrap(() => ListHTTPRequests())).map((r) =>
      normalizeHTTPSavedRequest(r),
    ),
  saveHTTPRequest: (r: model.HTTPSavedRequestDO) => unwrap(() => SaveHTTPRequest(r)),
  moveHTTPRequestToFolder: (id: string, folderId: string) =>
    unwrap(() => MoveHTTPRequestToFolder(id, folderId)),
  deleteHTTPRequest: (id: string) => unwrap(() => DeleteHTTPRequest(id)),
  executeHTTPRequest: async (req: model.HTTPExecuteRequestDO) => unwrap(() => ExecuteHTTPRequest(req)),
  listHTTPFolders: async () =>
    asArray(await unwrap(() => ListHTTPFolders())).map((f) => normalizeHTTPFolder(f)),
  saveHTTPFolder: (f: model.HTTPFolderDO) => unwrap(() => SaveHTTPFolder(f)),
  deleteHTTPFolder: (id: string) => unwrap(() => DeleteHTTPFolder(id)),
  applyHTTPApiTreeLayout: (layout: model.HTTPApiTreeLayoutDO) => unwrap(() => ApplyHTTPApiTreeLayout(layout)),
  batchDeleteHTTP: (folderIds: string[], requestIds: string[]) => unwrap(() => BatchDeleteHTTP(folderIds, requestIds)),
  listHTTPEnvironments: async () => asArray(await unwrap(() => ListHTTPEnvironments())),
  saveHTTPEnvironment: (e: model.HTTPEnvironmentDO) => unwrap(() => SaveHTTPEnvironment(e)),
  deleteHTTPEnvironment: (id: string) => unwrap(() => DeleteHTTPEnvironment(id)),
  listLogSources: async () => asArray(await unwrap(() => ListLogSources())),
  saveLogSource: (src: model.LogSourceDO) => unwrap(() => SaveLogSource(src)),
  deleteLogSource: (id: string) => unwrap(() => DeleteLogSource(id)),
  fetchLogSource: async (id: string, tail: number) =>
    (await unwrap(() => FetchLogSource(id, tail))) as { content: string },
  fetchLogSourceConfig: async (src: model.LogSourceDO, tail: number) =>
    (await unwrap(() => FetchLogSourceConfig(src, tail))) as { content: string },
  startLogFollow: (src: model.LogSourceDO, tail: number) => unwrap(() => StartLogFollow(src, tail)),
  stopLogFollow: (streamId: string) => unwrap(() => StopLogFollow(streamId)),
  pickLogFilePath: () => unwrap(() => PickLogFilePath()),
  listAppSettings: async () => (await unwrap(() => ListAppSettings())) ?? {},
  setAppSetting: (key: string, value: string) => unwrap(() => SetAppSetting(key, value)),
  loadWorkspace: async (product: string) => (await unwrap(() => LoadWorkspace(product))) ?? '',
  saveWorkspace: (product: string, content: string) => unwrap(() => SaveWorkspace(product, content)),
  listEnvRuntimes: async () => asArray(await unwrap(() => ListEnvRuntimes())),
  listEnvVersions: async (lang: string) => asArray(await unwrap(() => ListEnvVersions(lang))),
  useEnvVersion: (lang: string, version: string) => unwrap(() => UseEnvVersion(lang, version)),
  installEnvVersion: (lang: string, version: string) => unwrap(() => InstallEnvVersion(lang, version)),
  installEnvManager: (lang: string) => unwrap(() => InstallEnvManager(lang)),
  ensureEnvVersion: (lang: string, version: string) => unwrap(() => EnsureEnvVersion(lang, version)),
  uninstallEnvVersion: (lang: string, version: string) => unwrap(() => UninstallEnvVersion(lang, version)),
  listEnvPresets: async () => asArray(await unwrap(() => ListEnvPresets())),
  saveEnvPreset: (preset: { id: string; name: string; active: boolean; runtimes: Record<string, string> }) =>
    unwrap(() => SaveEnvPreset(
        model.EnvPresetDO.createFrom({
          id: preset.id,
          name: preset.name,
          active: preset.active,
          runtimes: preset.runtimes,
        })
      )
    ),
  deleteEnvPreset: (id: string) => unwrap(() => DeleteEnvPreset(id)),
  applyEnvPreset: async (id: string) => unwrap(() => ApplyEnvPreset(id)),
  scanEnvProjects: async (root: string) => asArray(await unwrap(() => ScanEnvProjects(root))),
  pickEnvScanDirectory: async () => (await unwrap(() => PickEnvScanDirectory())) ?? '',
  getEnvScanPath: async () => (await unwrap(() => GetEnvScanPath())) ?? '',
  listNotebookGroups: async () => asArray(await unwrap(() => ListNotebookGroups())),
  saveNotebookGroup: (g: model.NotebookGroupDO) => unwrap(() => SaveNotebookGroup(g)),
  applyNotebookLayout: (layout: model.NotebookLayoutDO) => unwrap(() => ApplyNotebookLayout(layout)),
  deleteNotebookGroup: (id: string) => unwrap(() => DeleteNotebookGroup(id)),
  listNotes: async () => asArray(await unwrap(() => ListNotes())),
  searchNotes: async (keyword: string) => asArray(await unwrap(() => SearchNotes(keyword))),
  getNote: async (id: string) => unwrap(() => GetNote(id)),
  saveNote: (n: model.NoteDO) => unwrap(() => SaveNote(n)),
  deleteNote: (id: string) => unwrap(() => DeleteNote(id)),
  deleteNotes: (ids: string[]) => unwrap(() => DeleteNotes(ids)),
  getNotebookUI: async () => unwrap(() => GetNotebookUI()),
  saveNotebookUI: (ui: model.NotebookUIDO) => unwrap(() => SaveNotebookUI(ui)),
  duplicateNote: async (id: string) => unwrap(() => DuplicateNote(id)),
  exportNote: async (id: string) => (await unwrap(() => ExportNote(id))).path,
  getAgentSettings: async () => unwrap(() => GetAgentSettings()),
  listAgentCapabilities: async () => asArray(await unwrap(() => ListAgentCapabilities())),
  applyAgentProviderPreset: async (provider: string) => unwrap(() => ApplyAgentProviderPreset(provider)),
  testAgentConnection: async () => unwrap(() => TestAgentConnection()),
  saveAgentSettings: (in_: model.AgentSettingsSaveDO) => unwrap(() => SaveAgentSettings(in_)),
  saveAgentAPIConfig: (in_: model.AgentAPIConfigSaveDO) => unwrap(() => SaveAgentAPIConfig(in_)),
  saveAgentPermissions: (in_: model.AgentPermissionsSaveDO) => unwrap(() => SaveAgentPermissions(in_)),
  getMCPStatus: async () => unwrap(() => GetMCPStatus()),
  saveMCPConfig: (in_: model.MCPConfigSaveDO) => unwrap(() => SaveMCPConfig(in_)),
  agentChat: async (req: model.AgentChatRequestDO) => unwrap(() => AgentChat(req)),
  agentStop: (threadId: string) => unwrap(() => AgentStop(threadId)),
  agentConfirm: (pendingId: string, approved: boolean) => unwrap(() => AgentConfirm(pendingId, approved)),
  agentRewind: (threadId: string, keepSeq: number) => unwrap(() => AgentRewind(threadId, keepSeq)),
  listAgentMessages: async (threadId: string) => asArray(await unwrap(() => ListAgentMessages(threadId))),
  listAgentThreads: async () => asArray(await unwrap(() => ListAgentThreads())),
  listAgentSkills: async () => asArray(await unwrap(() => ListAgentSkills())),
  listSkillsDir: async (subPath: string) => asArray(await unwrap(() => ListSkillsDir(subPath))),
  listEnabledAgentSkills: async () => asArray(await unwrap(() => ListEnabledAgentSkills())),
  getAgentSkill: async (id: string) => unwrap(() => GetAgentSkill(id)),
  getAgentSkillFile: async (path: string) => unwrap(() => GetAgentSkillFile(path)),
  setAgentSkillEnabled: async (inDO: model.AgentSkillEnabledDO) => unwrap(() => SetAgentSkillEnabled(inDO)),
  saveAgentSkill: async (inDO: model.AgentSkillSaveDO) => unwrap(() => SaveAgentSkill(inDO)),
  saveAgentSkillFile: async (inDO: model.AgentSkillFileSaveDO) => unwrap(() => SaveAgentSkillFile(inDO)),
  createAgentSkill: async (inDO: model.AgentSkillCreateDO) => unwrap(() => CreateAgentSkill(inDO)),
  deleteAgentSkill: async (id: string) => unwrap(() => DeleteAgentSkill(id)),
  publishAgentSkill: async (inDO: model.AgentSkillPublishDO) => unwrap(() => PublishAgentSkill(inDO)),
  getAgentThread: async (threadId: string) => unwrap(() => GetAgentThread(threadId)),
  setAgentThreadBindings: async (
    threadId: string,
    mentions: { kind: string; id: string; label: string }[],
  ) => unwrap(() => SetAgentThreadBindings(threadId, mentions)),
  setAgentThreadSkillIds: async (threadId: string, skillIds: string[]) =>
    unwrap(() => SetAgentThreadSkillIDs(threadId, skillIds)),
}

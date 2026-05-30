import type {
  ApiResult,
  Connection,
  FileEntry,
  LocalDirResult,
  SSHHost,
  SftpBookmark,
  TransferConflict,
  SFTPSessionInfo,
  TableDataPage,
  TableDataQuery,
  TableRow,
  TerminalSessionInfo,
} from './types'
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
  ListIndexes,
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
  ExportTableInsertSQL,
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
  ListHTTPRequests,
  SaveHTTPRequest,
  DeleteHTTPRequest,
  ExecuteHTTPRequest,
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
  ListNotes,
  SearchNotes,
  GetNote,
  SaveNote,
  DeleteNote,
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
  listIndexes: async (sessionId: string, database: string, table: string) =>
    asArray(await unwrap(ListIndexes(sessionId, database, table))),
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
  openSFTPSession: (hostId: string) => unwrap(OpenSFTPSession(hostId)) as Promise<SFTPSessionInfo>,
  closeSFTPSession: (sessionId: string) => unwrap(CloseSFTPSession(sessionId)),
  getSFTPHome: (sessionId: string) => unwrap(GetSFTPHome(sessionId)),
  listSFTPDir: async (sessionId: string, path: string) =>
    asFileEntries(await unwrap(ListSFTPDir(sessionId, path))),
  listLocalDir: async (path: string) => normalizeLocalDir(await unwrap(ListLocalDir(path))),
  downloadSFTPFile: (sessionId: string, remotePath: string) =>
    unwrap(DownloadSFTPFile(sessionId, remotePath)),
  uploadSFTPFile: (sessionId: string, remoteDir: string) =>
    unwrap(UploadSFTPFile(sessionId, remoteDir)),
  deleteSFTPPath: (sessionId: string, remotePath: string) =>
    unwrap(DeleteSFTPPath(sessionId, remotePath)),
  transferSFTPUpload: (sessionId: string, taskId: string, localPath: string, remoteDir: string) =>
    unwrap(TransferSFTPUpload(sessionId, taskId, localPath, remoteDir)),
  transferSFTPDownload: (sessionId: string, taskId: string, remotePath: string, localDir: string) =>
    unwrap(TransferSFTPDownload(sessionId, taskId, remotePath, localDir)),
  mkdirSFTPRemote: (sessionId: string, dir: string) => unwrap(MkdirSFTPRemote(sessionId, dir)),
  renameSFTPRemote: (sessionId: string, oldPath: string, newPath: string) =>
    unwrap(RenameSFTPRemote(sessionId, oldPath, newPath)),
  mkdirLocalPath: (dir: string) => unwrap(MkdirLocalPath(dir)),
  renameLocalPath: (oldPath: string, newPath: string) => unwrap(RenameLocalPath(oldPath, newPath)),
  deleteLocalPath: (target: string) => unwrap(DeleteLocalPath(target)),
  listSFTPBookmarks: async (side: string, hostId: string) =>
    asArray(await unwrap(ListSFTPBookmarks(side, hostId))) as SftpBookmark[],
  saveSFTPBookmark: (b: SftpBookmark) =>
    unwrap(
      SaveSFTPBookmark(
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
  deleteSFTPBookmark: (id: string) => unwrap(DeleteSFTPBookmark(id)),
  checkSFTPUploadConflict: (sessionId: string, localPath: string, remoteDir: string) =>
    unwrap(CheckSFTPUploadConflict(sessionId, localPath, remoteDir)) as Promise<TransferConflict>,
  checkSFTPDownloadConflict: (sessionId: string, remotePath: string, localDir: string) =>
    unwrap(CheckSFTPDownloadConflict(sessionId, remotePath, localDir)) as Promise<TransferConflict>,
  cancelSFTPTask: (taskId: string) => unwrap(CancelSFTPTask(taskId)),
  exportConnectionsToFile: async (includeSecrets: boolean) =>
    (await unwrap(ExportConnectionsToFile(includeSecrets))).path,
  importConnectionsFromFile: () => unwrap(ImportConnectionsFromFile()),
  executeSQLFile: (sessionId: string, database: string) =>
    unwrap(ExecuteSQLFile(sessionId, database)),
  exportTableInsertSQL: async (sessionId: string, database: string, table: string, maxRows: number) =>
    (await unwrap(ExportTableInsertSQL(sessionId, database, table, maxRows))).path,
  ensureSSHHostFromConnection: async (connectionId: string) => unwrap(EnsureSSHHostFromConnection(connectionId)),
  listDockerContexts: async () => asArray(await unwrap(ListDockerContexts())),
  saveDockerContext: (ctx: model.DockerContextDO) => unwrap(SaveDockerContext(ctx)),
  deleteDockerContext: (id: string) => unwrap(DeleteDockerContext(id)),
  testDockerContext: (contextId: string) => unwrap(TestDockerContext(contextId)),
  listContainers: async (contextId: string) => asArray(await unwrap(ListContainers(contextId))),
  listImages: async (contextId: string) => asArray(await unwrap(ListImages(contextId))),
  startContainer: (contextId: string, containerId: string) => unwrap(StartContainer(contextId, containerId)),
  stopContainer: (contextId: string, containerId: string) => unwrap(StopContainer(contextId, containerId)),
  restartContainer: (contextId: string, containerId: string) => unwrap(RestartContainer(contextId, containerId)),
  removeContainer: (contextId: string, containerId: string) => unwrap(RemoveContainer(contextId, containerId)),
  getContainerLogs: async (contextId: string, containerId: string, tail: number) =>
    (await unwrap(GetContainerLogs(contextId, containerId, tail))).content,
  getContainerEnv: async (contextId: string, containerId: string) =>
    unwrap(GetContainerEnv(contextId, containerId)),
  getContainerRunPreset: async (image: string) => unwrap(GetContainerRunPreset(image)),
  runContainer: async (contextId: string, spec: model.ContainerRunDO) =>
    unwrap(RunContainer(contextId, spec)),
  getContainerShell: async (contextId: string, containerId: string) =>
    unwrap(GetContainerShell(contextId, containerId)),
  resolveContainerDatabaseLink: async (contextId: string, containerId: string) =>
    unwrap(ResolveContainerDatabaseLink(contextId, containerId)),
  pickDockerComposeDirectory: async (contextId: string) =>
    (await unwrap(PickDockerComposeDirectory(contextId))) ?? '',
  getDockerComposeDirectory: async (contextId: string) =>
    (await unwrap(GetDockerComposeDirectory(contextId))) ?? '',
  listComposeServices: async (contextId: string, projectDir: string) =>
    asArray(await unwrap(ListComposeServices(contextId, projectDir))),
  composeUp: async (contextId: string, projectDir: string) => unwrap(ComposeUp(contextId, projectDir)),
  composeDown: async (contextId: string, projectDir: string) => unwrap(ComposeDown(contextId, projectDir)),
  composePull: async (contextId: string, projectDir: string) => unwrap(ComposePull(contextId, projectDir)),
  getComposeLogs: async (contextId: string, projectDir: string, service: string, tail: number) =>
    (await unwrap(GetComposeLogs(contextId, projectDir, service, tail))).content,
  composeRestart: async (contextId: string, projectDir: string, service: string) =>
    unwrap(ComposeRestart(contextId, projectDir, service)),
  listSSHForwardPresets: async () => asArray(await unwrap(ListSSHForwardPresets())),
  saveSSHForwardPreset: (p: model.SSHForwardPresetDO) => unwrap(SaveSSHForwardPreset(p)),
  deleteSSHForwardPreset: (id: string) => unwrap(DeleteSSHForwardPreset(id)),
  listActiveSSHForwards: async () => asArray(await unwrap(ListActiveSSHForwards())),
  startSSHForward: async (req: model.SSHForwardStartDO) => unwrap(StartSSHForward(req)),
  stopSSHForward: (id: string) => unwrap(StopSSHForward(id)),
  listHTTPRequests: async () => asArray(await unwrap(ListHTTPRequests())),
  saveHTTPRequest: (r: model.HTTPSavedRequestDO) => unwrap(SaveHTTPRequest(r)),
  deleteHTTPRequest: (id: string) => unwrap(DeleteHTTPRequest(id)),
  executeHTTPRequest: async (req: model.HTTPExecuteRequestDO) => unwrap(ExecuteHTTPRequest(req)),
  listAppSettings: async () => (await unwrap(ListAppSettings())) ?? {},
  setAppSetting: (key: string, value: string) => unwrap(SetAppSetting(key, value)),
  loadWorkspace: async (product: string) => (await unwrap(LoadWorkspace(product))) ?? '',
  saveWorkspace: (product: string, content: string) => unwrap(SaveWorkspace(product, content)),
  listEnvRuntimes: async () => asArray(await unwrap(ListEnvRuntimes())),
  listEnvVersions: async (lang: string) => asArray(await unwrap(ListEnvVersions(lang))),
  useEnvVersion: (lang: string, version: string) => unwrap(UseEnvVersion(lang, version)),
  installEnvVersion: (lang: string, version: string) => unwrap(InstallEnvVersion(lang, version)),
  installEnvManager: (lang: string) => unwrap(InstallEnvManager(lang)),
  ensureEnvVersion: (lang: string, version: string) => unwrap(EnsureEnvVersion(lang, version)),
  uninstallEnvVersion: (lang: string, version: string) => unwrap(UninstallEnvVersion(lang, version)),
  listEnvPresets: async () => asArray(await unwrap(ListEnvPresets())),
  saveEnvPreset: (preset: { id: string; name: string; active: boolean; runtimes: Record<string, string> }) =>
    unwrap(
      SaveEnvPreset(
        model.EnvPresetDO.createFrom({
          id: preset.id,
          name: preset.name,
          active: preset.active,
          runtimes: preset.runtimes,
        })
      )
    ),
  deleteEnvPreset: (id: string) => unwrap(DeleteEnvPreset(id)),
  applyEnvPreset: async (id: string) => unwrap(ApplyEnvPreset(id)),
  scanEnvProjects: async (root: string) => asArray(await unwrap(ScanEnvProjects(root))),
  pickEnvScanDirectory: async () => (await unwrap(PickEnvScanDirectory())) ?? '',
  getEnvScanPath: async () => (await unwrap(GetEnvScanPath())) ?? '',
  listNotebookGroups: async () => asArray(await unwrap(ListNotebookGroups())),
  saveNotebookGroup: (g: model.NotebookGroupDO) => unwrap(SaveNotebookGroup(g)),
  deleteNotebookGroup: (id: string) => unwrap(DeleteNotebookGroup(id)),
  listNotes: async () => asArray(await unwrap(ListNotes())),
  searchNotes: async (keyword: string) => asArray(await unwrap(SearchNotes(keyword))),
  getNote: async (id: string) => unwrap(GetNote(id)),
  saveNote: (n: model.NoteDO) => unwrap(SaveNote(n)),
  deleteNote: (id: string) => unwrap(DeleteNote(id)),
  getNotebookUI: async () => unwrap(GetNotebookUI()),
  saveNotebookUI: (ui: model.NotebookUIDO) => unwrap(SaveNotebookUI(ui)),
  duplicateNote: async (id: string) => unwrap(DuplicateNote(id)),
  exportNote: async (id: string) => (await unwrap(ExportNote(id))).path,
}

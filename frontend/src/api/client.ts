import type {
  ApiResult,
  ColumnMeta,
  Connection,
  FileEntry,
  LocalDirResult,
  LocalPortKillResult,
  LocalPortProcess,
  SSHHost,
  CloudAccount,
  ECSInstance,
  ECSMonitor,
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
import { model, workbenchtools } from '../../wailsjs/go/models'

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
  ListCloudAccounts,
  SaveCloudAccount,
  GetECSMonitor,
  ListECSInstances,
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
  PickSFTPUploadPaths,
  PickSFTPUploadDir,
  PickSFTPDownloadDir,
  DeleteSFTPPath,
  ReadSFTPText,
  ReadSFTPBinary,
  WriteSFTPText,
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
  DropDatabase,
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
  UpdateContainerSpec,
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
  ListBackupPolicies,
  SaveBackupPolicy,
  DeleteBackupPolicy,
  DeleteBackupPolicies,
  ListBackupRuns,
  ListTaskRuns,
  GetTaskRun,
  SyncTaskRunLog,
  RenameTaskRun,
  DeleteTaskRuns,
  CloseTaskRun,
  FinishBrowserReplay,
  ReplayTaskStep,
  DistillWorkflow,
  UpdateSkill,
  ListDirVersions,
  MapDirVersionFlags,
  EnableDirVersion,
  PinDirVersion,
  RestoreDirVersion,
  ListSkillVersions,
  PinSkillVersion,
  RestoreSkillVersion,
  PublishWorkflow,
  ListWorkflows,
  GetWorkflow,
  RunWorkflow,
  SaveWorkflow,
  RunBackupPolicy,
  ScanHostHealth,
  EnsureHostBackupPolicies,
  EnsureHostMemoryBook,
  GetHostProject,
  ListHostProjects,
  PickLocalProjectDir,
  SaveHostProject,
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
  AgentChoose,
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
  DrainAgentWritePending,
  GetAgentThread,
  SetAgentThreadBindings,
  SetAgentThreadSkillIDs,
  SetAgentThreadMode,
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
  PublishNoteAsSkill,
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
  SaveNotebookAsset,
  PickNotebookAssets,
  NotebookWorkspacePath,
  NoteDiskPath,
  RevealNotebookNote,
  RevealNotebookPath,
  RevealNotebookWorkspace,
  RenameNotebookPath,
  MoveNotebookPath,
  CopyNotebookPath,
  DeleteNotebookPath,
  CreateNotebookDir,
  CreateNotebookFile,
  ListPluginPacks,
  GetPluginPack,
  GetPluginProtocol,
  SetPluginPackEnabled,
  GetPluginPackSourcePath,
  BuildPluginPackUI,
  ReadPluginPackUIFile,
  RevealPluginPackPath,
  ListPluginPackReleases,
  SnapshotPluginPack,
  RollbackPluginPack,
  ResolveMCPConfirm,
  GrantMCPWriteDir,
  RevokeMCPWriteDir,
  ListMCPWriteDirs,
  ProbeTerminalCwd,
  GetBrowserStatus,
  ListBrowserTabs,
  AttachBrowserTab,
  BrowserSnapshot,
  BrowserClick,
  BrowserFill,
  BrowserFind,
  BrowserWait,
  BrowserKeys,
  BrowserScreenshot,
  BrowserNavigate,
  BrowserOpenFrame,
  StartBrowserRecording,
  StopBrowserRecording,
  RevealBrowserExtDir,
  OpenChromeExtensionsPage,
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
    cloudAccountId: h.cloudAccountId || '',
    cloudRegion: h.cloudRegion || '',
    cloudInstanceId: h.cloudInstanceId || '',
    touchCloud: Boolean(h.touchCloud),
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  })
}

/** toCloudAccountDO 转为 Wails 绑定的云账号模型。 */
export function toCloudAccountDO(a: CloudAccount): model.CloudAccountDO {
  return model.CloudAccountDO.createFrom({
    id: a.id,
    name: a.name,
    provider: a.provider || 'aliyun',
    accessKeyId: a.accessKeyId,
    accessKeySecret: a.accessKeySecret || '',
    hasSecret: Boolean(a.hasSecret),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
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
  listCloudAccounts: async () => asArray(await unwrap(() => ListCloudAccounts())) as CloudAccount[],
  saveCloudAccount: (a: CloudAccount) => unwrap(() => SaveCloudAccount(toCloudAccountDO(a))),
  getECSMonitor: (hostId: string) => unwrap(() => GetECSMonitor(hostId)) as Promise<ECSMonitor>,
  listECSInstances: async (accountId: string, region: string) =>
    asArray(await unwrap(() => ListECSInstances(accountId, region))) as ECSInstance[],
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
  pickSFTPUploadPaths: async () => asArray(await unwrap(() => PickSFTPUploadPaths())) as string[],
  pickSFTPUploadDir: () => unwrap(() => PickSFTPUploadDir()) as Promise<string>,
  pickSFTPDownloadDir: (defaultDir = '') => unwrap(() => PickSFTPDownloadDir(defaultDir)) as Promise<string>,
  readSFTPText: (sessionId: string, remotePath: string) =>
    unwrap(() => ReadSFTPText(sessionId, remotePath)) as Promise<{
      path: string
      name: string
      content: string
      size: number
      encoding: string
    }>,
  readSFTPBinary: (sessionId: string, remotePath: string) =>
    unwrap(() => ReadSFTPBinary(sessionId, remotePath)) as Promise<{
      path: string
      name: string
      mime: string
      content: string
      size: number
    }>,
  writeSFTPText: (sessionId: string, remotePath: string, content: string) =>
    unwrap(() => WriteSFTPText(sessionId, remotePath, content)),
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
  dropDatabase: (sessionId: string, name: string) => unwrap(() => DropDatabase(sessionId, name)),
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
  updateContainerSpec: async (contextId: string, containerId: string, update: model.ContainerUpdateDO) =>
    unwrap(() => UpdateContainerSpec(contextId, containerId, update)),
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
  listBackupPolicies: async () => asArray(await unwrap(() => ListBackupPolicies())) as import('./types').BackupPolicy[],
  saveBackupPolicy: (p: model.BackupPolicyDO) =>
    unwrap(() => SaveBackupPolicy(p)) as Promise<import('./types').BackupPolicy>,
  deleteBackupPolicy: (id: string) => unwrap(() => DeleteBackupPolicy(id)),
  deleteBackupPolicies: async (ids: string[]) =>
    (await unwrap(() => DeleteBackupPolicies(ids))) as {
      deleted: number
      requested: number
      cronErrors?: string[]
      note?: string
    },
  listBackupRuns: async (policyId = '', limit = 30) =>
    asArray(await unwrap(() => ListBackupRuns(policyId, limit))) as import('./types').BackupRun[],
  listTaskRuns: async (session = '', limit = 30) =>
    asArray(await unwrap(() => ListTaskRuns(session, limit))) as import('./types').TaskRun[],
  getTaskRun: async (runId: string) =>
    (await unwrap(() => GetTaskRun(runId))) as import('./types').TaskRunDetail,
  syncTaskRunLog: async (runId: string) =>
    (await unwrap(() => SyncTaskRunLog(runId))) as {
      ok?: boolean
      noteId?: string
      scopeRoot?: string
      skillName?: string
    },
  renameTaskRun: (runId: string, title: string) => unwrap(() => RenameTaskRun(runId, title)),
  deleteTaskRuns: async (ids: string[]) =>
    (await unwrap(() => DeleteTaskRuns(ids))) as number,
  closeTaskRun: (runId: string) => unwrap(() => CloseTaskRun(runId)),
  finishBrowserReplay: (sourceRunId: string) => unwrap(() => FinishBrowserReplay(sourceRunId)),
  replayTaskStep: async (runId: string, seq: number, skip = false, intent = '舞台逐步重放') =>
    (await unwrap(() => ReplayTaskStep(runId, seq, skip, intent))) as {
      ok?: boolean
      seq?: number
      nextSeq?: number | null
      skipped?: boolean
      action?: string
      resolveNote?: string
      coach?: string
      log?: string
      sourceRunId?: string
      taskRunId?: string
    },
  distillWorkflow: async (
    runId: string,
    name = '',
    title = '',
    intent = '舞台生成工作流',
    dropSeqs: number[] = [],
  ) =>
    (await unwrap(() =>
      DistillWorkflow(runId, name, title, intent, dropSeqs.length ? JSON.stringify(dropSeqs) : ''),
    )) as {
      ok?: boolean
      workflow?: import('./types').Workflow
      noteId?: string
      note?: string
    },
  /** 更新已有 Skill（经验/脚本/资源；新建交给 Agent） */
  updateSkill: async (in_: {
    name: string
    intent?: string
    title?: string
    description?: string
    lessons?: string
    sourceRunId?: string
  }) =>
    (await unwrap(() =>
      UpdateSkill(
        workbenchtools.UpdateSkillArgs.createFrom({
          name: in_.name,
          intent: in_.intent || '舞台更新技能',
          title: in_.title || '',
          description: in_.description || '',
          lessons: in_.lessons || '',
          script: '',
          scriptLang: '',
          resourcePaths: [],
          steps: [],
          sourceRunId: in_.sourceRunId || '',
        }),
      ),
    )) as { ok?: boolean; note?: string; workflow?: import('./types').Workflow },
  /** 工作流笔记 → 关联 skillId（笔记 SSOT） */
  publishWorkflow: async (noteId: string, skillId = '') =>
    (await unwrap(() => PublishWorkflow(noteId, skillId))) as {
      ok?: boolean
      skill?: { id?: string; name?: string }
      noteId?: string
      skillId?: string
      note?: string
    },
  listWorkflows: async (limit = 30) =>
    asArray(await unwrap(() => ListWorkflows(limit))) as import('./types').Workflow[],
  getWorkflow: async (nameOrId: string) =>
    (await unwrap(() => GetWorkflow(nameOrId))) as import('./types').Workflow,
  runWorkflow: async (name: string, session = '', intent = '舞台运行工作流') =>
    (await unwrap(() => RunWorkflow(name, session, intent))) as {
      ok?: boolean
      workflow?: string
      paused?: boolean
      executed?: unknown[]
      total?: number
      coach?: string
      note?: string
    },
  saveWorkflow: async (workflow: import('./types').Workflow) =>
    (await unwrap(() => SaveWorkflow(workflow as never))) as import('./types').Workflow,
  runBackupPolicy: (policyId: string, intent: string, force = false) =>
    unwrap(() => RunBackupPolicy(policyId, intent, force)),
  scanHostHealth: async (sshHostId: string, workDir: string) =>
    (await unwrap(() => ScanHostHealth(sshHostId, workDir))) as import('./types').HostHealthReport,
  ensureHostBackupPolicies: async (
    sshHostId: string,
    workDir: string,
    findingIds: string[],
    withCron = true,
  ) =>
    (await unwrap(() =>
      EnsureHostBackupPolicies(sshHostId, workDir, findingIds, withCron),
    )) as import('./types').EnsureHostBackupResult,
  ensureHostMemoryBook: (sshHostId: string) =>
    unwrap(() => EnsureHostMemoryBook(sshHostId)) as Promise<import('./types').HostMemoryBook>,
  getHostProject: (dirRel: string) =>
    unwrap(() => GetHostProject(dirRel)) as Promise<import('./types').HostProject>,
  listHostProjects: async (sshHostId = '') =>
    asArray(await unwrap(() => ListHostProjects(sshHostId))) as import('./types').HostProject[],
  pickLocalProjectDir: (defaultDir = '') =>
    unwrap(() => PickLocalProjectDir(defaultDir)) as Promise<string>,
  saveHostProject: (p: import('./types').HostProject) =>
    unwrap(() =>
      SaveHostProject(
        model.HostProjectDO.createFrom({
          dirRel: p.dirRel,
          name: p.name || '',
          sshHostId: p.sshHostId || '',
          localPath: p.localPath || '',
          remotePath: p.remotePath || '',
          noteId: p.noteId || '',
          skillNoteId: p.skillNoteId || '',
        }),
      ),
    ) as Promise<import('./types').HostProject>,
  listLogSources: async () => asArray(await unwrap(() => ListLogSources())),
  saveLogSource: (src: model.LogSourceDO) => unwrap(() => SaveLogSource(src)),
  deleteLogSource: (id: string) => unwrap(() => DeleteLogSource(id)),
  fetchLogSource: async (id: string, tail: number, skipFromEnd = 0) =>
    (await unwrap(() => FetchLogSource(id, tail, skipFromEnd))) as { content: string },
  fetchLogSourceConfig: async (src: model.LogSourceDO, tail: number, skipFromEnd = 0) =>
    (await unwrap(() => FetchLogSourceConfig(src, tail, skipFromEnd))) as { content: string },
  startLogFollow: (src: model.LogSourceDO, tail: number) => unwrap(() => StartLogFollow(src, tail)),
  stopLogFollow: (streamId: string) => unwrap(() => StopLogFollow(streamId)),
  pickLogFilePath: () => unwrap(() => PickLogFilePath()),
  listAppSettings: async () => (await unwrap(() => ListAppSettings())) ?? {},
  setAppSetting: (key: string, value: string) => unwrap(() => SetAppSetting(key, value)),
  loadWorkspace: async (product: string) => (await unwrap(() => LoadWorkspace(product))) ?? '',
  saveWorkspace: (product: string, content: string) => unwrap(() => SaveWorkspace(product, content)),
  listEnvRuntimes: async (sshHostId = '') => asArray(await unwrap(() => ListEnvRuntimes(sshHostId))),
  listEnvVersions: async (sshHostId: string, lang: string) =>
    asArray(await unwrap(() => ListEnvVersions(sshHostId, lang))),
  useEnvVersion: (sshHostId: string, lang: string, version: string) =>
    unwrap(() => UseEnvVersion(sshHostId, lang, version)),
  installEnvVersion: (sshHostId: string, lang: string, version: string) =>
    unwrap(() => InstallEnvVersion(sshHostId, lang, version)),
  installEnvManager: (sshHostId: string, lang: string) => unwrap(() => InstallEnvManager(sshHostId, lang)),
  ensureEnvVersion: (sshHostId: string, lang: string, version: string) =>
    unwrap(() => EnsureEnvVersion(sshHostId, lang, version)),
  uninstallEnvVersion: (sshHostId: string, lang: string, version: string) =>
    unwrap(() => UninstallEnvVersion(sshHostId, lang, version)),
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
  applyEnvPreset: async (id: string, sshHostId = '') =>
    unwrap(() => ApplyEnvPreset(id, sshHostId)),
  scanEnvProjects: async (root: string) => asArray(await unwrap(() => ScanEnvProjects(root))),
  pickEnvScanDirectory: async () => (await unwrap(() => PickEnvScanDirectory())) ?? '',
  getEnvScanPath: async () => (await unwrap(() => GetEnvScanPath())) ?? '',
  listNotebookGroups: async () => asArray(await unwrap(() => ListNotebookGroups())),
  saveNotebookGroup: (g: model.NotebookGroupDO) => unwrap(() => SaveNotebookGroup(g)),
  applyNotebookLayout: (layout: model.NotebookLayoutDO) => unwrap(() => ApplyNotebookLayout(layout)),
  deleteNotebookGroup: (id: string) => unwrap(() => DeleteNotebookGroup(id)),
  listNotes: async () => asArray(await unwrap(() => ListNotes())),
  listDirVersions: async (dirRel: string, limit = 24) =>
    (await unwrap(() => ListDirVersions(dirRel, limit))) as {
      ok?: boolean
      rel?: string
      enabled?: boolean
      head?: string
      working?: boolean
      versions?: { hash: string; short: string; subject: string; when: string }[]
      total?: number
    },
  mapDirVersionFlags: async (dirRels: string[]) => {
    const raw = (await unwrap(() => MapDirVersionFlags(dirRels))) as {
      ok?: boolean
      flags?: Record<string, boolean>
    }
    const flags = raw?.flags || {}
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(flags)) {
      out[k] = Boolean(v)
    }
    return out
  },
  enableDirVersion: async (dirRel: string) =>
    (await unwrap(() => EnableDirVersion(dirRel))) as {
      ok?: boolean
      rel?: string
      enabled?: boolean
      head?: string
      versions?: { hash: string; short: string; subject: string; when: string }[]
    },
  pinDirVersion: async (dirRel: string, message = 'create_version') =>
    (await unwrap(() => PinDirVersion(dirRel, message))) as {
      ok?: boolean
      rel?: string
      version?: { hash?: string; short?: string; subject?: string; when?: string }
    },
  restoreDirVersion: async (dirRel: string, hash: string, intent = '舞台回退目录版本') =>
    (await unwrap(() => RestoreDirVersion(dirRel, hash, intent))) as {
      ok?: boolean
      rel?: string
      restored?: string
      pinned?: { hash?: string; short?: string; subject?: string; when?: string }
    },
  listSkillVersions: async (skillName: string, limit = 24) =>
    (await unwrap(() => ListSkillVersions(skillName, limit))) as {
      ok?: boolean
      name?: string
      noteId?: string
      rel?: string
      enabled?: boolean
      head?: string
      working?: boolean
      versions?: { hash: string; short: string; subject: string; when: string }[]
      total?: number
    },
  pinSkillVersion: async (skillName: string, message = 'create_version') =>
    (await unwrap(() => PinSkillVersion(skillName, message))) as {
      ok?: boolean
      skill?: string
      version?: { hash?: string; short?: string; subject?: string; when?: string }
    },
  restoreSkillVersion: async (skillName: string, hash: string, intent = '舞台回退 Skill 版本') =>
    (await unwrap(() => RestoreSkillVersion(skillName, hash, intent))) as {
      ok?: boolean
      skill?: string
      noteId?: string
      restored?: string
      pinned?: { hash?: string; short?: string; subject?: string; when?: string }
    },
  searchNotes: async (keyword: string) => asArray(await unwrap(() => SearchNotes(keyword))),
  getNote: async (id: string) => unwrap(() => GetNote(id)),
  saveNote: (n: model.NoteDO) => unwrap(() => SaveNote(n)),
  deleteNote: (id: string) => unwrap(() => DeleteNote(id)),
  deleteNotes: (ids: string[]) => unwrap(() => DeleteNotes(ids)),
  getNotebookUI: async () => unwrap(() => GetNotebookUI()),
  saveNotebookUI: (ui: model.NotebookUIDO) => unwrap(() => SaveNotebookUI(ui)),
  duplicateNote: async (id: string) => unwrap(() => DuplicateNote(id)),
  exportNote: async (id: string) => (await unwrap(() => ExportNote(id))).path,
  saveNotebookAsset: (in_: model.NotebookAssetUploadDO) => unwrap(() => SaveNotebookAsset(in_)),
  pickNotebookAssets: async (noteId: string, imagesOnly: boolean) =>
    asArray(await unwrap(() => PickNotebookAssets(noteId, imagesOnly))),
  notebookWorkspacePath: async () => (await unwrap(() => NotebookWorkspacePath())) ?? '',
  noteDiskPath: async (noteId: string) => (await unwrap(() => NoteDiskPath(noteId))) ?? '',
  revealNotebookNote: (noteId: string) => unwrap(() => RevealNotebookNote(noteId)),
  revealNotebookPath: (rel: string) => unwrap(() => RevealNotebookPath(rel)),
  revealNotebookWorkspace: () => unwrap(() => RevealNotebookWorkspace()),
  renameNotebookPath: (rel: string, newName: string) =>
    unwrap(() => RenameNotebookPath(rel, newName)) as Promise<{ from: string; to: string }>,
  moveNotebookPath: (fromRel: string, destDirRel: string) =>
    unwrap(() => MoveNotebookPath(fromRel, destDirRel)) as Promise<{ from: string; to: string }>,
  copyNotebookPath: (fromRel: string, destDirRel: string) =>
    unwrap(() => CopyNotebookPath(fromRel, destDirRel)) as Promise<{ from: string; to: string }>,
  deleteNotebookPath: (rel: string) => unwrap(() => DeleteNotebookPath(rel)),
  createNotebookDir: (parentRel: string, name: string) =>
    unwrap(() => CreateNotebookDir(parentRel, name)) as Promise<string>,
  createNotebookFile: (parentRel: string, name: string) => unwrap(() => CreateNotebookFile(parentRel, name)),
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
  agentChoose: (answers: model.AgentChoiceAnswerDO[]) => unwrap(() => AgentChoose(answers)),
  drainAgentWritePending: async (threadId: string) =>
    unwrap(() => DrainAgentWritePending(threadId)),
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
  publishNoteAsSkill: async (inDO: model.AgentSkillPublishDO) => unwrap(() => PublishNoteAsSkill(inDO)),
  getAgentThread: async (threadId: string) => unwrap(() => GetAgentThread(threadId)),
  setAgentThreadBindings: async (
    threadId: string,
    mentions: { kind: string; id: string; label: string }[],
  ) => unwrap(() => SetAgentThreadBindings(threadId, mentions)),
  setAgentThreadSkillIds: async (threadId: string, skillIds: string[]) =>
    unwrap(() => SetAgentThreadSkillIDs(threadId, skillIds)),
  setAgentThreadMode: async (threadId: string, mode: string) =>
    unwrap(() => SetAgentThreadMode(threadId, mode)),
  listPluginPacks: async () => asArray(await unwrap(() => ListPluginPacks())) as import('./pluginPack').PluginPackInfo[],
  getPluginPack: async (packId: string) =>
    unwrap(() => GetPluginPack(packId)) as Promise<import('./pluginPack').PluginPackInfo>,
  getPluginProtocol: async () =>
    unwrap(() => GetPluginProtocol()) as Promise<import('./pluginPack').PluginProtocolInfo>,
  setPluginPackEnabled: async (packId: string, enabled: boolean) =>
    unwrap(() => SetPluginPackEnabled(packId, enabled)) as Promise<import('./pluginPack').PluginPackInfo>,
  getPluginPackSourcePath: async (packId: string) => unwrap(() => GetPluginPackSourcePath(packId)),
  buildPluginPackUI: async (packId: string) =>
    unwrap(() => BuildPluginPackUI(packId)) as Promise<import('./pluginPack').PluginPackBuildResult>,
  readPluginPackUIFile: async (packId: string, rel: string) => unwrap(() => ReadPluginPackUIFile(packId, rel)),
  revealPluginPackPath: async (path: string) => unwrap(() => RevealPluginPackPath(path)),
  listPluginPackReleases: async (packId: string) =>
    asArray(await unwrap(() => ListPluginPackReleases(packId))) as import('./pluginPack').PluginPackReleaseInfo[],
  snapshotPluginPack: async (packId: string) =>
    unwrap(() => SnapshotPluginPack(packId)) as Promise<import('./pluginPack').PluginPackReleaseInfo>,
  rollbackPluginPack: async (packId: string, releaseId: string) =>
    unwrap(() => RollbackPluginPack(packId, releaseId)) as Promise<import('./pluginPack').PluginPackInfo>,
  resolveMCPConfirm: async (pendingId: string, approved: boolean) =>
    unwrap(() => ResolveMCPConfirm(pendingId, approved)),
  probeTerminalCwd: async (sessionId: string) =>
    unwrap(() => ProbeTerminalCwd(sessionId)) as Promise<{
      sessionId: string
      hostKey: string
      kind: string
      path: string
    }>,
  grantMCPWriteDir: async (sessionId: string) =>
    unwrap(() => GrantMCPWriteDir(sessionId)) as Promise<{
      hostKey: string
      path: string
      at: number
      kind?: string
    }>,
  revokeMCPWriteDir: async (sessionId: string, path = '') =>
    unwrap(() => RevokeMCPWriteDir(sessionId, path)),
  listMCPWriteDirs: async () =>
    asArray(await unwrap(() => ListMCPWriteDirs())) as Array<{
      hostKey: string
      path: string
      at: number
      kind?: string
    }>,
  getBrowserStatus: () => unwrap(() => GetBrowserStatus()),
  listBrowserTabs: () => unwrap(() => ListBrowserTabs()),
  attachBrowserTab: (tabId: number) => unwrap(() => AttachBrowserTab(tabId)),
  browserSnapshot: (maxNodes: number, frame = '') => unwrap(() => BrowserSnapshot(maxNodes, frame)),
  browserClick: (ref: string, selector = '', mode = 'auto', frame = '') =>
    unwrap(() => BrowserClick(ref, selector, mode, frame)),
  browserFill: (ref: string, value: string, selector = '', frame = '') =>
    unwrap(() => BrowserFill(ref, selector, value, frame)),
  browserFind: (query: string, maxNodes = 200, frame = '') =>
    unwrap(() => BrowserFind(query, maxNodes, frame)),
  browserWait: (opts: {
    text?: string
    textGone?: string
    nameIncludes?: string
    ref?: string
    selector?: string
    timeoutMs?: number
    frame?: string
  }) =>
    unwrap(() =>
      BrowserWait(
        opts.text || '',
        opts.textGone || '',
        opts.nameIncludes || '',
        opts.ref || '',
        opts.selector || '',
        opts.timeoutMs || 0,
        opts.frame || '',
      ),
    ),
  browserKeys: (keys: string, ref = '', selector = '', repeat = 1, frame = '') =>
    unwrap(() => BrowserKeys(keys, ref, selector, repeat, frame)),
  browserScreenshot: (format = 'jpeg', quality = 72) =>
    unwrap(() => BrowserScreenshot(format, quality)) as Promise<{
      path: string
      sizeBytes: number
      format: string
      url?: string
      title?: string
      dataUrl?: string
      viewport?: { width: number; height: number; dpr?: number }
    }>,
  browserNavigate: (url: string, newTab = false) => unwrap(() => BrowserNavigate(url, newTab)),
  browserOpenFrame: (frame: string, forceNewTab = false) =>
    unwrap(() => BrowserOpenFrame(frame, forceNewTab)),
  startBrowserRecording: async (title = '') =>
    (await unwrap(() => StartBrowserRecording(title))) as {
      ok?: boolean
      recording?: boolean
      session?: string
      taskRunId?: string
      tabId?: number
      url?: string
      title?: string
    },
  stopBrowserRecording: async () =>
    (await unwrap(() => StopBrowserRecording())) as {
      ok?: boolean
      recording?: boolean
      session?: string
    },
  revealBrowserExtDir: () =>
    unwrap(() => RevealBrowserExtDir()) as Promise<{ path: string }>,
  openChromeExtensionsPage: () =>
    unwrap(() => OpenChromeExtensionsPage()) as Promise<{ opened: boolean; url?: string; hint?: string }>,
}

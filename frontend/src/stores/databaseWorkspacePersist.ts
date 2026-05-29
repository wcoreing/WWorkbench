import type { TableDesignDraft } from '../features/table-design/tableDesignDraft'
import { api } from '../api/client'
import type { WorkTab } from './workTab'
import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'database'
const STORAGE_KEY = 'wn-database-workspace.json'
const SNAPSHOT_VERSION = 1

/** DatabaseWorkspaceSnapshot 数据库工作区 JSON 快照。 */
export interface DatabaseWorkspaceSnapshot {
  version: number
  tabs: WorkTab[]
  activeTabId: string | null
  designDrafts: Record<string, TableDesignDraft>
}

const DEFAULT_TABS: WorkTab[] = [
  { id: 'sql-1', kind: 'sql', title: '无标题 - 查询', sql: '-- 输入 SQL\nSELECT 1;\n' },
]

const DEFAULT_ACTIVE_TAB_ID = 'sql-1'

/** defaultDatabaseWorkspace 默认工作区状态。 */
export function defaultDatabaseWorkspace() {
  return {
    tabs: [...DEFAULT_TABS],
    activeTabId: DEFAULT_ACTIVE_TAB_ID,
    designDrafts: {} as Record<string, TableDesignDraft>,
  }
}

/** isWorkTab 校验 Tab 结构是否合法。 */
function isWorkTab(raw: unknown): raw is WorkTab {
  if (!raw || typeof raw !== 'object') return false
  const t = raw as WorkTab
  if (!t.id || !t.kind || !t.title) return false
  switch (t.kind) {
    case 'sql':
      return typeof t.sql === 'string'
    case 'table':
      return typeof t.database === 'string' && typeof t.table === 'string'
    case 'ddl':
      return typeof t.content === 'string'
    case 'design':
      return typeof t.database === 'string' && (t.mode === 'create' || t.mode === 'alter')
    default:
      return false
  }
}

/** parseDatabaseWorkspace 解析快照对象。 */
function parseDatabaseWorkspace(data: DatabaseWorkspaceSnapshot | null) {
  if (!data || data.version !== SNAPSHOT_VERSION) return defaultDatabaseWorkspace()
  const tabs = Array.isArray(data.tabs) ? data.tabs.filter(isWorkTab) : []
  if (!tabs.length) return defaultDatabaseWorkspace()
  const activeTabId =
    data.activeTabId && tabs.some((t) => t.id === data.activeTabId) ? data.activeTabId : tabs[0].id
  const designDrafts =
    data.designDrafts && typeof data.designDrafts === 'object' ? data.designDrafts : {}
  return { tabs, activeTabId, designDrafts }
}

/** migrateDatabaseWorkspaceFromLocalStorage 从 localStorage 迁移旧快照。 */
function migrateDatabaseWorkspaceFromLocalStorage(): DatabaseWorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as DatabaseWorkspaceSnapshot
  } catch {
    return null
  }
}

/** hydrateDatabaseWorkspace 从 dataDir 加载数据库工作区（含迁移）。 */
export async function hydrateDatabaseWorkspace() {
  let data = await loadWorkspaceSnapshot<DatabaseWorkspaceSnapshot>(PRODUCT)
  if (!data) {
    data = migrateDatabaseWorkspaceFromLocalStorage()
    if (data) {
      const payload: DatabaseWorkspaceSnapshot = { version: SNAPSHOT_VERSION, ...parseDatabaseWorkspace(data) }
      await api.saveWorkspace(PRODUCT, JSON.stringify(payload)).catch(() => {})
      localStorage.removeItem(STORAGE_KEY)
    }
  }
  return parseDatabaseWorkspace(data)
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** subscribeDatabaseWorkspacePersist 订阅 store 变更并防抖保存。 */
export function subscribeDatabaseWorkspacePersist(
  getSnapshot: () => Omit<DatabaseWorkspaceSnapshot, 'version'>
) {
  return () => {
    saveWorkspace({
      version: SNAPSHOT_VERSION,
      ...getSnapshot(),
    })
  }
}

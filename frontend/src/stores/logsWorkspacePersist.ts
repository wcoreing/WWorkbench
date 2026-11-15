import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'logs'
const SNAPSHOT_VERSION = 1

export type LogsPane = 'sources' | 'audit'

export interface LogsWorkspaceSnapshot {
  version: number
  activeId: string
  pane?: LogsPane
}

export function defaultLogsWorkspace(): LogsWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeId: '', pane: 'sources' }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleLogsWorkspacePersist 防抖保存日志工作区。 */
export function scheduleLogsWorkspacePersist(snapshot: LogsWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadLogsWorkspace 加载日志工作区快照。 */
export async function loadLogsWorkspace(): Promise<LogsWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<LogsWorkspaceSnapshot>(PRODUCT)
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  return data
}

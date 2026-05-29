import type { PaneLayout } from '../features/terminal/terminalLayout'
import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'terminal'
const SNAPSHOT_VERSION = 1

/** TerminalTabSnapshot 终端标签持久化结构（不含会话 ID）。 */
export interface TerminalTabSnapshot {
  hostId: string
  kind: 'local' | 'ssh'
  title: string
  layout: PaneLayout
}

/** TerminalWorkspaceSnapshot 终端工作区 JSON 快照。 */
export interface TerminalWorkspaceSnapshot {
  version: number
  tabs: TerminalTabSnapshot[]
  activeTabIndex: number
}

export interface TerminalTabPersistInput {
  id: string
  hostId: string
  kind: 'local' | 'ssh'
  title: string
  layout: PaneLayout
}

/** toTerminalWorkspaceSnapshot 将运行中标签转为可持久化快照。 */
export function toTerminalWorkspaceSnapshot(
  tabs: TerminalTabPersistInput[],
  activeTabId: string | null
): TerminalWorkspaceSnapshot {
  const activeTabIndex = Math.max(0, tabs.findIndex((t) => t.id === activeTabId))
  return {
    version: SNAPSHOT_VERSION,
    tabs: tabs.map((t) => ({
      hostId: t.hostId,
      kind: t.kind,
      title: t.title,
      layout: t.layout,
    })),
    activeTabIndex: tabs.length ? activeTabIndex : 0,
  }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleTerminalWorkspacePersist 防抖保存终端工作区。 */
export function scheduleTerminalWorkspacePersist(snapshot: TerminalWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadTerminalWorkspace 加载终端工作区快照。 */
export async function loadTerminalWorkspace(): Promise<TerminalWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<TerminalWorkspaceSnapshot>(PRODUCT)
  if (!data || data.version !== SNAPSHOT_VERSION || !Array.isArray(data.tabs)) return null
  return data
}

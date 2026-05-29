import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'sftp'
const SNAPSHOT_VERSION = 1

/** SftpTabSnapshot SFTP 标签持久化结构（不含会话 ID）。 */
export interface SftpTabSnapshot {
  hostId: string
  title: string
  localPath: string
  remotePath: string
}

/** SftpWorkspaceSnapshot SFTP 工作区 JSON 快照。 */
export interface SftpWorkspaceSnapshot {
  version: number
  tabs: SftpTabSnapshot[]
  activeTabIndex: number
}

export interface SftpTabPersistInput {
  id: string
  hostId: string
  title: string
  localPath: string
  remotePath: string
}

/** toSftpWorkspaceSnapshot 将运行中标签转为可持久化快照。 */
export function toSftpWorkspaceSnapshot(tabs: SftpTabPersistInput[], activeTabId: string | null): SftpWorkspaceSnapshot {
  const activeTabIndex = Math.max(0, tabs.findIndex((t) => t.id === activeTabId))
  return {
    version: SNAPSHOT_VERSION,
    tabs: tabs.map((t) => ({
      hostId: t.hostId,
      title: t.title,
      localPath: t.localPath,
      remotePath: t.remotePath,
    })),
    activeTabIndex: tabs.length ? activeTabIndex : 0,
  }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleSftpWorkspacePersist 防抖保存 SFTP 工作区。 */
export function scheduleSftpWorkspacePersist(snapshot: SftpWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadSftpWorkspace 加载 SFTP 工作区快照。 */
export async function loadSftpWorkspace(): Promise<SftpWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<SftpWorkspaceSnapshot>(PRODUCT)
  if (!data || data.version !== SNAPSHOT_VERSION || !Array.isArray(data.tabs)) return null
  return data
}

import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'httpapi'
const SNAPSHOT_VERSION = 1

export interface HttpApiWorkspaceSnapshot {
  version: number
  activeId: string
}

export function defaultHttpApiWorkspace(): HttpApiWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeId: '' }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleHttpApiWorkspacePersist 防抖保存 API 工作区。 */
export function scheduleHttpApiWorkspacePersist(snapshot: HttpApiWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadHttpApiWorkspace 加载 API 工作区快照。 */
export async function loadHttpApiWorkspace(): Promise<HttpApiWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<HttpApiWorkspaceSnapshot>(PRODUCT)
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  return data
}

import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'httpapi'
const SNAPSHOT_VERSION = 2

export interface HttpApiWorkspaceSnapshot {
  version: number
  activeId: string
  activeEnvId: string
}

export function defaultHttpApiWorkspace(): HttpApiWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeId: '', activeEnvId: '' }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleHttpApiWorkspacePersist 防抖保存 API 工作区。 */
export function scheduleHttpApiWorkspacePersist(snapshot: HttpApiWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadHttpApiWorkspace 加载 API 工作区快照。 */
export async function loadHttpApiWorkspace(): Promise<HttpApiWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<HttpApiWorkspaceSnapshot>(PRODUCT)
  if (!data) return null
  if (data.version === 2) return data
  if (data.version === 1 && 'activeId' in data) {
    return { version: SNAPSHOT_VERSION, activeId: (data as { activeId: string }).activeId, activeEnvId: '' }
  }
  return null
}

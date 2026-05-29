import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'docker'
const SNAPSHOT_VERSION = 1

export type DockerView = 'containers' | 'images'

/** DockerWorkspaceSnapshot Docker 工作区 JSON 快照。 */
export interface DockerWorkspaceSnapshot {
  version: number
  activeContextId: string
  view: DockerView
}

/** defaultDockerWorkspace 默认 Docker 工作区快照。 */
export function defaultDockerWorkspace(): DockerWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeContextId: 'local', view: 'containers' }
}

/** toDockerWorkspaceSnapshot 构建 Docker 工作区快照。 */
export function toDockerWorkspaceSnapshot(activeContextId: string, view: DockerView): DockerWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeContextId, view }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleDockerWorkspacePersist 防抖保存 Docker 工作区。 */
export function scheduleDockerWorkspacePersist(snapshot: DockerWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadDockerWorkspace 加载 Docker 工作区快照。 */
export async function loadDockerWorkspace(): Promise<DockerWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<DockerWorkspaceSnapshot>(PRODUCT)
  if (!data || data.version !== SNAPSHOT_VERSION) return null
  return data
}

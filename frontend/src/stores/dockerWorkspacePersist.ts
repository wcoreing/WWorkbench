import { createDebouncedWorkspaceSaver, loadWorkspaceSnapshot } from './workspacePersist'

const PRODUCT = 'docker'
const SNAPSHOT_VERSION = 2

export type DockerView = 'containers' | 'images' | 'compose'

/** DockerWorkspaceSnapshot Docker 工作区 JSON 快照。 */
export interface DockerWorkspaceSnapshot {
  version: number
  activeContextId: string
  view: DockerView
  composeProjectDir?: string
}

/** defaultDockerWorkspace 默认 Docker 工作区快照。 */
export function defaultDockerWorkspace(): DockerWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeContextId: 'local', view: 'containers', composeProjectDir: '' }
}

/** toDockerWorkspaceSnapshot 构建 Docker 工作区快照。 */
export function toDockerWorkspaceSnapshot(
  activeContextId: string,
  view: DockerView,
  composeProjectDir = '',
): DockerWorkspaceSnapshot {
  return { version: SNAPSHOT_VERSION, activeContextId, view, composeProjectDir }
}

const saveWorkspace = createDebouncedWorkspaceSaver(PRODUCT)

/** scheduleDockerWorkspacePersist 防抖保存 Docker 工作区。 */
export function scheduleDockerWorkspacePersist(snapshot: DockerWorkspaceSnapshot) {
  saveWorkspace(snapshot)
}

/** loadDockerWorkspace 加载 Docker 工作区快照。 */
export async function loadDockerWorkspace(): Promise<DockerWorkspaceSnapshot | null> {
  const data = await loadWorkspaceSnapshot<DockerWorkspaceSnapshot>(PRODUCT)
  if (!data) return null
  if (data.version === 1) {
    return { version: SNAPSHOT_VERSION, activeContextId: data.activeContextId, view: data.view, composeProjectDir: '' }
  }
  if (data.version !== SNAPSHOT_VERSION) return null
  return data
}

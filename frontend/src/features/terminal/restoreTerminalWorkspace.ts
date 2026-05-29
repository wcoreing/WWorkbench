import { api } from '../../api/client'
import { withSSHHostTrust, type SSHTrustConfirm } from '../../api/sshTrust'
import type { SSHHost } from '../../api/types'
import { createLeaf, collectSessionIds, firstLeafId, type PaneLayout } from './terminalLayout'
import type { TerminalTabSnapshot } from '../../stores/terminalWorkspacePersist'

export interface RestoredTerminalTab {
  id: string
  hostId: string
  kind: 'local' | 'ssh'
  title: string
  layout: PaneLayout
  activePaneId: string
}

/** rebuildTerminalLayout 按快照结构重建分屏并打开新会话。 */
async function rebuildTerminalLayout(
  layout: PaneLayout,
  openSession: () => Promise<string>
): Promise<PaneLayout> {
  if (layout.kind === 'leaf') {
    const sessionId = await openSession()
    return createLeaf(sessionId)
  }
  const first = await rebuildTerminalLayout(layout.first, openSession)
  const second = await rebuildTerminalLayout(layout.second, openSession)
  return { ...layout, first, second }
}

/** restoreTerminalTab 从快照恢复单个终端标签。 */
export async function restoreTerminalTab(
  snap: TerminalTabSnapshot,
  hosts: SSHHost[],
  confirmTrust: SSHTrustConfirm
): Promise<RestoredTerminalTab | null> {
  const openSession = async (): Promise<string> => {
    if (snap.kind === 'local') {
      const info = await api.openLocalTerminal(120, 32)
      return info.sessionId
    }
    const host = hosts.find((h) => h.id === snap.hostId)
    if (!host) throw new Error('SSH 主机不存在')
    const info = await withSSHHostTrust(host.host, host.port, () => api.openTerminal(host.id, 120, 32), confirmTrust)
    return info.sessionId
  }
  const layout = await rebuildTerminalLayout(snap.layout, openSession)
  const sessionIds = collectSessionIds(layout)
  if (!sessionIds.length) return null
  return {
    id: `term-${sessionIds[0]}`,
    hostId: snap.hostId,
    kind: snap.kind,
    title: snap.title,
    layout,
    activePaneId: firstLeafId(layout),
  }
}

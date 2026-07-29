import { api } from '../../api/client'
import { withSSHHostTrust, type SSHTrustConfirm } from '../../api/sshTrust'
import type { ShellHost } from '../../api/types'
import type { SftpTabSnapshot } from '../../stores/sftpWorkspacePersist'

export interface RestoredSftpTab {
  id: string
  sessionId: string
  hostId: string
  title: string
  localPath: string
  remotePath: string
}

/** restoreSftpTab 从快照恢复 SFTP 标签。 */
export async function restoreSftpTab(
  snap: SftpTabSnapshot,
  hosts: ShellHost[],
  confirmTrust: SSHTrustConfirm
): Promise<RestoredSftpTab | null> {
  const host = hosts.find((h) => h.id === snap.hostId)
  if (!host) return null
  const open = () => api.openSFTPSession(host.id)
  const info =
    host.kind === 'docker'
      ? await open()
      : await withSSHHostTrust(host.host || '', host.port || 22, open, confirmTrust)
  return {
    id: `sftp-${info.sessionId}`,
    sessionId: info.sessionId,
    hostId: host.id,
    title: snap.title || host.name,
    localPath: snap.localPath,
    remotePath: snap.remotePath,
  }
}

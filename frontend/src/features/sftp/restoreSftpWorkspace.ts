import { api } from '../../api/client'
import { withSSHHostTrust, type SSHTrustConfirm } from '../../api/sshTrust'
import type { SSHHost } from '../../api/types'
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
  hosts: SSHHost[],
  confirmTrust: SSHTrustConfirm
): Promise<RestoredSftpTab | null> {
  const host = hosts.find((h) => h.id === snap.hostId)
  if (!host) return null
  const info = await withSSHHostTrust(host.host, host.port, () => api.openSFTPSession(host.id), confirmTrust)
  return {
    id: `sftp-${info.sessionId}`,
    sessionId: info.sessionId,
    hostId: host.id,
    title: snap.title || host.name,
    localPath: snap.localPath,
    remotePath: snap.remotePath,
  }
}

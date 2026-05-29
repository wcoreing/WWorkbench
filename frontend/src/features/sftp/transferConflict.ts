import type { TransferKind } from './useSftpTransferQueue'
import { api } from '../../api/client'
import type { TransferConflict } from '../../api/types'
import type { ConflictAction } from './SftpConflictDialog'

/** filterPathsWithConflict 过滤路径并处理同名冲突 */
export async function filterPathsWithConflict(
  kind: TransferKind,
  sessionId: string,
  paths: string[],
  targetDir: string,
  ask: (kind: TransferKind, conflict: TransferConflict, remaining: number) => Promise<ConflictAction>
): Promise<string[]> {
  const accepted: string[] = []
  let skipAll = false

  for (let i = 0; i < paths.length; i++) {
    if (skipAll) break
    const p = paths[i]
    const remaining = paths.length - i
    const conflict =
      kind === 'upload'
        ? await api.checkSFTPUploadConflict(sessionId, p, targetDir)
        : await api.checkSFTPDownloadConflict(sessionId, p, targetDir)

    if (!conflict.hasConflict) {
      accepted.push(p)
      continue
    }

    const action = await ask(kind, conflict, remaining)
    if (action === 'cancel-all') break
    if (action === 'skip-all') {
      skipAll = true
      break
    }
    if (action === 'skip') continue
    accepted.push(p)
  }

  return accepted
}

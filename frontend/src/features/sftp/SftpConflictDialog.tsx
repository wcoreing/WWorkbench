import type { TransferConflict } from '../../api/types'
import { formatBytes, formatFullModTime } from './sftpUtils'
import '../../components/ui.css'

export type ConflictAction = 'overwrite' | 'skip' | 'skip-all' | 'cancel-all'

interface Props {
  open: boolean
  kind: 'upload' | 'download'
  conflict: TransferConflict
  remaining: number
  onAction: (action: ConflictAction) => void
}

/** SftpConflictDialog 同名文件冲突对比弹窗 */
export function SftpConflictDialog({ open, kind, conflict, remaining, onAction }: Props) {
  if (!open) return null

  const sourceLabel = kind === 'upload' ? '本地（待上传）' : '远程（待下载）'
  const targetLabel = kind === 'upload' ? '远程（已存在）' : '本地（已存在）'

  return (
    <div className="wn-modal-backdrop ssh-trust-backdrop" onClick={() => onAction('cancel-all')}>
      <div className="wn-modal wn-modal-compact sftp-conflict-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="wn-modal-header">
          <h2 className="wn-modal-title">文件已存在：{conflict.name}</h2>
          <p className="wn-modal-desc">
            {kind === 'upload' ? '上传' : '下载'}目标已有同名{conflict.targetIsDir ? '文件夹' : '文件'}，请确认如何处理
            {remaining > 1 ? `（还有 ${remaining - 1} 项待检查）` : ''}
          </p>
        </header>
        <div className="wn-modal-body">
          <table className="sftp-conflict-table">
            <thead>
              <tr>
                <th />
                <th>{sourceLabel}</th>
                <th>{targetLabel}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sftp-conflict-key">大小</td>
                <td>{conflict.sourceIsDir ? '文件夹' : formatBytes(conflict.sourceSize)}</td>
                <td>{conflict.targetIsDir ? '文件夹' : formatBytes(conflict.targetSize)}</td>
              </tr>
              <tr>
                <td className="sftp-conflict-key">修改时间</td>
                <td>{formatFullModTime(conflict.sourceModTime)}</td>
                <td>{formatFullModTime(conflict.targetModTime)}</td>
              </tr>
              <tr>
                <td className="sftp-conflict-key">路径</td>
                <td className="sftp-conflict-path" title={conflict.sourcePath}>{conflict.sourcePath}</td>
                <td className="sftp-conflict-path" title={conflict.targetPath}>{conflict.targetPath}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="wn-modal-footer sftp-conflict-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={() => onAction('cancel-all')}>
            取消全部
          </button>
          {remaining > 1 && (
            <button type="button" className="wn-btn wn-btn-tool" onClick={() => onAction('skip-all')}>
              全部跳过
            </button>
          )}
          <button type="button" className="wn-btn wn-btn-tool" onClick={() => onAction('skip')}>
            跳过
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={() => onAction('overwrite')}>
            覆盖
          </button>
        </footer>
      </div>
    </div>
  )
}

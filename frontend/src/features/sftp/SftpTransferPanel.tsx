import { formatBytes } from './sftpUtils'
import type { TransferTask } from './useSftpTransferQueue'

interface Props {
  tasks: TransferTask[]
  onCancel?: (taskId: string) => void
  onClearFinished?: () => void
}

/** SftpTransferPanel 传输队列与多任务进度 */
export function SftpTransferPanel({ tasks, onCancel, onClearFinished }: Props) {
  if (!tasks.length) return null

  const queued = tasks.filter((t) => t.state === 'queued').length
  const running = tasks.filter((t) => t.state === 'running').length
  const hasFinished = tasks.some((t) => t.state === 'done' || t.state === 'error' || t.state === 'cancelled')

  return (
    <div className="sftp-transfer-panel">
      <div className="sftp-transfer-panel-header">
        <span>
          传输队列
          {running > 0 && ` · ${running} 进行中`}
          {queued > 0 && ` · ${queued} 等待`}
        </span>
        {hasFinished && onClearFinished && (
          <button type="button" className="wn-btn wn-btn-sm sftp-transfer-clear" onClick={onClearFinished}>
            清除已完成
          </button>
        )}
      </div>
      <div className="sftp-transfer-panel-body">
        {tasks.map((task) => (
          <TransferRow key={task.id} task={task} onCancel={onCancel} />
        ))}
      </div>
    </div>
  )
}

interface RowProps {
  task: TransferTask
  onCancel?: (taskId: string) => void
}

/** TransferRow 单条传输任务行 */
function TransferRow({ task, onCancel }: RowProps) {
  const pct = task.total > 0 ? Math.min(100, Math.round((task.done / task.total) * 100)) : 0
  const kindLabel = task.kind === 'upload' ? '上传' : '下载'
  const canCancel = task.state === 'queued' || task.state === 'running'

  if (task.state === 'queued') {
    return (
      <div className="sftp-transfer-row queued">
        <span className="sftp-transfer-label">{kindLabel} {task.name}</span>
        <span className="sftp-transfer-meta">等待中…</span>
        {canCancel && onCancel && (
          <button type="button" className="sftp-transfer-cancel" onClick={() => onCancel(task.id)}>
            取消
          </button>
        )}
      </div>
    )
  }

  if (task.state === 'done') {
    return (
      <div className="sftp-transfer-row done">
        <span className="sftp-transfer-label">{kindLabel}完成：{task.name}</span>
      </div>
    )
  }

  if (task.state === 'cancelled') {
    return (
      <div className="sftp-transfer-row cancelled">
        <span className="sftp-transfer-label">已取消：{task.name}</span>
      </div>
    )
  }

  if (task.state === 'error') {
    return (
      <div className="sftp-transfer-row error">
        <span className="sftp-transfer-label">{kindLabel}失败：{task.name}</span>
        {task.error && <span className="sftp-transfer-meta">{task.error}</span>}
      </div>
    )
  }

  return (
    <div className="sftp-transfer-row running">
      <span className="sftp-transfer-label">{kindLabel} {task.name}</span>
      <div className="sftp-transfer-track">
        <div className="sftp-transfer-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="sftp-transfer-meta">
        {formatBytes(task.done)} / {task.total > 0 ? formatBytes(task.total) : '—'}
      </span>
      {canCancel && onCancel && (
        <button type="button" className="sftp-transfer-cancel" onClick={() => onCancel(task.id)}>
          取消
        </button>
      )}
    </div>
  )
}

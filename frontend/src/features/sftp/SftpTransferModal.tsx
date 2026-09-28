import { useEffect, useRef, useState } from 'react'
import { pressProps } from '../../components/compat'
import { IconArrowDown, IconFolder, IconUpload } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { formatBytes } from './sftpUtils'
import type { TransferTask } from './useSftpTransferQueue'

export type TransferModalMode = 'upload' | 'download'

export interface StagedTransfer {
  id: string
  path: string
  name: string
}

interface Props {
  open: boolean
  mode: TransferModalMode
  /** 上传目标远程目录 / 下载来源远程目录说明 */
  remotePath: string
  /** 下载保存目录 */
  localDir?: string
  staged: StagedTransfer[]
  tasks: TransferTask[]
  onAddFiles?: () => void
  onAddFolder?: () => void
  onChangeDownloadDir?: () => void
  onRemoveStaged: (id: string) => void
  onClearStaged: () => void
  onStart: () => void
  onCancelTask: (taskId: string) => void
  onClose: () => void
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

/** statusLabel 任务状态文案 */
function statusLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  task: TransferTask,
): string {
  if (task.state === 'queued') return t('sftp.transferQueued')
  if (task.state === 'running') {
    if (task.total > 0) {
      const pct = Math.min(100, Math.round((task.done / task.total) * 100))
      return `${formatBytes(task.done)} / ${formatBytes(task.total)} · ${pct}%`
    }
    return formatBytes(task.done) || (task.kind === 'upload' ? t('sftp.uploading') : t('sftp.downloading'))
  }
  if (task.state === 'done') return task.kind === 'upload' ? t('sftp.uploadDone') : t('sftp.downloadDone')
  if (task.state === 'cancelled') return t('sftp.cancelled')
  return task.error || t('sftp.transferFailed')
}

/** SftpTransferModal 宝塔式传输队列：上传/下载先入列再开始，可关窗续传。 */
export function SftpTransferModal({
  open,
  mode,
  remotePath,
  localDir = '',
  staged,
  tasks,
  onAddFiles,
  onAddFolder,
  onChangeDownloadDir,
  onRemoveStaged,
  onClearStaged,
  onStart,
  onCancelTask,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])

  if (!open) return null

  const modeTasks = tasks.filter((x) => x.kind === mode)
  const otherTasks = tasks.filter((x) => x.kind !== mode)
  const canStart = staged.length > 0
  const canClear =
    staged.length > 0 || modeTasks.some((x) => x.state === 'done' || x.state === 'error' || x.state === 'cancelled')

  const title =
    mode === 'upload'
      ? t('sftp.uploadToPath', { path: remotePath || '/' })
      : t('sftp.downloadToPath', { path: localDir || remotePath || '/' })

  const waitingLabel = mode === 'upload' ? t('sftp.waitingUpload') : t('sftp.waitingDownload')
  const startLabel = mode === 'upload' ? t('sftp.startUpload') : t('sftp.startDownload')
  const emptyHint = mode === 'upload' ? t('sftp.uploadListEmpty') : t('sftp.downloadListEmpty')

  return (
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div
        className="wn-modal wn-modal-wide sftp-upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sftp-transfer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wn-modal-header-bar">
          <h2 id="sftp-transfer-title" className="wn-modal-title sftp-upload-title">
            {title}
          </h2>
          <button type="button" className="wn-modal-close-btn" aria-label={t('common.close')} {...pressProps(onClose)}>
            ×
          </button>
        </header>

        <div className="sftp-upload-toolbar">
          {mode === 'upload' ? (
            <div className="sftp-upload-add" ref={menuRef}>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" {...pressProps(() => onAddFiles?.())}>
                <IconUpload size={14} />
                <span>{t('sftp.upload')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-primary sftp-upload-add-caret"
                title={t('sftp.uploadMore')}
                {...pressProps((e) => {
                  e.stopPropagation()
                  setMenuOpen((v) => !v)
                })}
              >
                <IconArrowDown size={12} />
              </button>
              {menuOpen && (
                <div className="sftp-upload-add-menu" onPointerDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="sftp-upload-add-item"
                    {...pressProps(() => {
                      setMenuOpen(false)
                      onAddFiles?.()
                    })}
                  >
                    <IconUpload size={14} />
                    {t('sftp.upload')}
                  </button>
                  <button
                    type="button"
                    className="sftp-upload-add-item"
                    {...pressProps(() => {
                      setMenuOpen(false)
                      onAddFolder?.()
                    })}
                  >
                    <IconFolder size={14} />
                    {t('sftp.uploadFolder')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-chrome"
              title={localDir}
              {...pressProps(() => onChangeDownloadDir?.())}
            >
              {t('sftp.changeDownloadDir')}
            </button>
          )}
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-chrome"
            disabled={!canClear}
            {...pressProps(onClearStaged, { disabled: !canClear })}
          >
            {t('sftp.clearUploadList')}
          </button>
        </div>

        <div className="sftp-upload-table-wrap">
          <table className="sftp-upload-table">
            <thead>
              <tr>
                <th>{t('sftp.colName')}</th>
                <th>{t('sftp.colSize')}</th>
                <th>{mode === 'upload' ? t('sftp.uploadStatus') : t('sftp.downloadStatus')}</th>
                <th>{t('sftp.colOps')}</th>
              </tr>
            </thead>
            <tbody>
              {staged.length === 0 && modeTasks.length === 0 && otherTasks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="sftp-upload-empty">
                    {emptyHint}
                  </td>
                </tr>
              ) : null}
              {staged.map((item) => (
                <tr key={`staged-${item.id}`}>
                  <td title={item.path}>
                    <span className="sftp-upload-name">{item.name || basename(item.path)}</span>
                  </td>
                  <td>-</td>
                  <td className="sftp-upload-status is-waiting">{waitingLabel}</td>
                  <td>
                    <button type="button" className="sftp-upload-action" {...pressProps(() => onRemoveStaged(item.id))}>
                      {t('common.cancel')}
                    </button>
                  </td>
                </tr>
              ))}
              {modeTasks.map((task) => (
                <tr key={task.id}>
                  <td title={task.sourcePath}>
                    <span className="sftp-upload-name">{task.name}</span>
                  </td>
                  <td>{task.total > 0 ? formatBytes(task.total) : '-'}</td>
                  <td className={`sftp-upload-status is-${task.state}`}>{statusLabel(t, task)}</td>
                  <td>
                    {(task.state === 'queued' || task.state === 'running') && (
                      <button type="button" className="sftp-upload-action" {...pressProps(() => onCancelTask(task.id))}>
                        {t('common.cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {otherTasks.map((task) => (
                <tr key={task.id} className="sftp-upload-row-other">
                  <td title={task.sourcePath}>
                    <span className="sftp-upload-name">
                      {task.kind === 'download' ? '↓ ' : '↑ '}
                      {task.name}
                    </span>
                  </td>
                  <td>{task.total > 0 ? formatBytes(task.total) : '-'}</td>
                  <td className={`sftp-upload-status is-${task.state}`}>{statusLabel(t, task)}</td>
                  <td>
                    {(task.state === 'queued' || task.state === 'running') && (
                      <button type="button" className="sftp-upload-action" {...pressProps(() => onCancelTask(task.id))}>
                        {t('common.cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="wn-modal-footer sftp-upload-footer">
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            disabled={!canStart}
            {...pressProps(onStart, { disabled: !canStart })}
          >
            {startLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

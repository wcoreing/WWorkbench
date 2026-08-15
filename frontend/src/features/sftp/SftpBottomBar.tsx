import { useCallback, useEffect, useRef, useState } from 'react'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { formatBytes } from './sftpUtils'
import type { TransferTask } from './useSftpTransferQueue'

const STORAGE_KEY = 'sftp_transfer_log_height'
const DEFAULT_HEIGHT = 120
const MIN_HEIGHT = 72
const MAX_HEIGHT = 420
const CHROME_HEIGHT = 28

interface Props {
  tasks: TransferTask[]
  onCancel?: (taskId: string) => void
  onClearFinished?: () => void
}

/** loadHeight 读取传输日志底栏高度。 */
function loadHeight(): number {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10)
    if (v >= MIN_HEIGHT && v <= MAX_HEIGHT) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_HEIGHT
}

/** useSftpBottomBarResize 底栏拖拽调高。 */
function useSftpBottomBarResize() {
  const [height, setHeight] = useState(loadHeight)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(DEFAULT_HEIGHT)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startY.current = e.clientY
    startHeight.current = height
    document.body.classList.add('is-sftp-log-resizing')
  }, [height])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startY.current - e.clientY
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight.current + delta))
      setHeight(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('is-sftp-log-resizing')
      setHeight((h) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(h))
        } catch {
          /* ignore */
        }
        return h
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-sftp-log-resizing')
    }
  }, [])

  return { height, onResizeStart }
}

/** SftpBottomBar SFTP 底栏：常显传输日志，可拖拽调高 */
export function SftpBottomBar({ tasks, onCancel, onClearFinished }: Props) {
  const { t } = useI18n()
  const { height, onResizeStart } = useSftpBottomBarResize()
  const queued = tasks.filter((x) => x.state === 'queued').length
  const running = tasks.filter((x) => x.state === 'running').length
  const hasActive = queued > 0 || running > 0
  const hasFinished = tasks.some((x) => x.state === 'done' || x.state === 'error' || x.state === 'cancelled')

  const runningTasks = tasks.filter((x) => x.state === 'running')
  const overall =
    runningTasks.length > 0
      ? (() => {
          const total = runningTasks.reduce((s, x) => s + Math.max(x.total, 0), 0)
          const done = runningTasks.reduce((s, x) => s + Math.max(x.done, 0), 0)
          if (total <= 0) return null
          return { done, total, pct: Math.min(100, Math.round((done / total) * 100)) }
        })()
      : null

  const summary = (() => {
    if (!tasks.length) return t('sftp.transferIdle')
    const parts: string[] = []
    if (running > 0) parts.push(t('sftp.transferRunning', { count: running }))
    if (queued > 0) parts.push(t('sftp.transferWaiting', { count: queued }))
    if (!parts.length) parts.push(t('sftp.transferLogCount', { count: tasks.length }))
    if (overall) parts.push(`${overall.pct}%`)
    return parts.join(' · ')
  })()

  return (
    <footer
      className={`sftp-bottom-bar${hasActive ? ' is-active' : ''}`}
      style={{ height }}
    >
      <div
        className="sftp-bottom-bar-resize"
        onMouseDown={onResizeStart}
        title={t('sftp.resizeTransferLog')}
      />
      <div className="sftp-bottom-bar-chrome">
        <span className="sftp-bottom-bar-title">{t('sftp.transferLog')}</span>
        <span className="sftp-bottom-bar-summary">{summary}</span>
        {overall && (
          <div className="sftp-bottom-bar-overall" title={`${formatBytes(overall.done)} / ${formatBytes(overall.total)}`}>
            <div className="sftp-transfer-track">
              <div className="sftp-transfer-fill" style={{ width: `${overall.pct}%` }} />
            </div>
            <span className="sftp-bottom-bar-pct">{overall.pct}%</span>
          </div>
        )}
        <span className="sftp-bottom-bar-spacer" />
        {hasFinished && onClearFinished && (
          <button type="button" className="wn-btn wn-btn-sm sftp-transfer-clear" {...pressProps(onClearFinished)}>
            {t('sftp.clearFinished')}
          </button>
        )}
      </div>
      <div className="sftp-bottom-bar-log" style={{ height: Math.max(0, height - CHROME_HEIGHT - 5) }}>
        {tasks.length === 0 ? (
          <div className="sftp-bottom-bar-empty">{t('sftp.transferLogEmpty')}</div>
        ) : (
          tasks.map((task) => <TransferRow key={task.id} task={task} onCancel={onCancel} />)
        )}
      </div>
    </footer>
  )
}

interface RowProps {
  task: TransferTask
  onCancel?: (taskId: string) => void
}

/** TransferRow 单条传输任务行（始终展示进度条） */
function TransferRow({ task, onCancel }: RowProps) {
  const { t } = useI18n()
  const kindLabel = task.kind === 'upload' ? t('sftp.upload') : t('sftp.download')
  const canCancel = task.state === 'queued' || task.state === 'running'
  const pct =
    task.state === 'done'
      ? 100
      : task.total > 0
        ? Math.min(100, Math.round((task.done / task.total) * 100))
        : task.state === 'running'
          ? 0
          : 0

  let label = `${kindLabel} ${task.name}`
  let meta = ''
  if (task.state === 'queued') {
    meta = t('sftp.transferQueued')
  } else if (task.state === 'done') {
    label = `${task.kind === 'upload' ? t('sftp.uploadDone') : t('sftp.downloadDone')}：${task.name}`
    meta = task.total > 0 ? formatBytes(task.total) : '100%'
  } else if (task.state === 'cancelled') {
    label = `${t('sftp.cancelled')}：${task.name}`
  } else if (task.state === 'error') {
    label = `${t('sftp.transferFailed')}：${task.name}`
    meta = task.error || ''
  } else {
    meta =
      task.total > 0
        ? `${formatBytes(task.done)} / ${formatBytes(task.total)} · ${pct}%`
        : formatBytes(task.done)
  }

  return (
    <div className={`sftp-transfer-row ${task.state}`}>
      <span className="sftp-transfer-label" title={label}>
        {label}
      </span>
      <div className="sftp-transfer-track">
        <div className="sftp-transfer-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="sftp-transfer-meta" title={meta}>
        {meta}
      </span>
      {canCancel && onCancel && (
        <button type="button" className="sftp-transfer-cancel" {...pressProps(() => onCancel(task.id))}>
          {t('common.cancel')}
        </button>
      )}
    </div>
  )
}

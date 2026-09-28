import { useCallback, useEffect, useRef, useState } from 'react'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { formatBytes } from './sftpUtils'

const MIN_SCALE = 0.25
const MAX_SCALE = 8
const ZOOM_STEP = 1.2

interface Props {
  open: boolean
  path: string
  name: string
  /** data URL，如 data:image/png;base64,... */
  src: string
  size: number
  onDownload?: () => void
  onClose: () => void
}

/** SftpImagePreview 远程图片预览弹窗（滚轮缩放 / 拖拽平移）。 */
export function SftpImagePreview({ open, path, name, src, size, onDownload, onClose }: Props) {
  const { t } = useI18n()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [open, path, src])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

  const zoomBy = useCallback((factor: number) => {
    setScale((prev) => clampScale(prev * factor))
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    setScale((prev) => clampScale(prev * factor))
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [offset],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setOffset({
      x: d.ox + (e.clientX - d.x),
      y: d.oy + (e.clientY - d.y),
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const onDoubleClick = useCallback(() => {
    if (scale === 1 && offset.x === 0 && offset.y === 0) {
      setScale(2)
    } else {
      resetView()
    }
  }, [scale, offset, resetView])

  if (!open) return null

  const pct = Math.round(scale * 100)

  return (
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div
        className="wn-modal wn-modal-xl sftp-image-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sftp-image-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wn-modal-header-bar">
          <h2 id="sftp-image-preview-title" className="wn-modal-title sftp-upload-title">
            {t('sftp.imagePreview')}
          </h2>
          <button type="button" className="wn-modal-close-btn" aria-label={t('common.close')} {...pressProps(onClose)}>
            ×
          </button>
        </header>

        <div className="sftp-image-preview-toolbar">
          <span className="sftp-image-preview-name" title={name}>
            {name}
          </span>
          <div className="sftp-image-preview-zoom">
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-chrome"
              title={t('sftp.imageZoomOut')}
              {...pressProps(() => zoomBy(1 / ZOOM_STEP))}
            >
              −
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-chrome sftp-image-preview-zoom-label"
              title={t('sftp.imageZoomReset')}
              {...pressProps(resetView)}
            >
              {pct}%
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-chrome"
              title={t('sftp.imageZoomIn')}
              {...pressProps(() => zoomBy(ZOOM_STEP))}
            >
              +
            </button>
          </div>
          {onDownload && (
            <button type="button" className="wn-btn wn-btn-sm wn-btn-chrome" {...pressProps(onDownload)}>
              {t('sftp.download')}
            </button>
          )}
        </div>

        <div
          ref={stageRef}
          className={`sftp-image-preview-stage${scale > 1 ? ' is-zoomed' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <img
            className="sftp-image-preview-img"
            src={src}
            alt={name}
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        </div>

        <footer className="sftp-text-editor-footer">
          <span className="sftp-text-editor-path" title={path}>
            {path}
          </span>
          <span>{formatBytes(size)}</span>
          <span className="sftp-image-preview-hint">{t('sftp.imageZoomHint')}</span>
        </footer>
      </div>
    </div>
  )
}

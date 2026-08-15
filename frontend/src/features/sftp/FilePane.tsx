import { useEffect, useRef, useState } from 'react'
import type { FileEntry, SftpBookmark } from '../../api/types'
import { IconFolder, IconRefresh } from '../../components/Icons'
import { pressProps } from '../../components/compat'
import {
  SFTP_DRAG_THRESHOLD,
  SFTP_INTERNAL_DROP_EVENT,
  beginSftpDrag,
  dispatchSftpDropAt,
  endSftpDrag,
  moveSftpDragCursor,
  type DragPayload,
} from './sftpInternalDrag'
import { formatBytes, formatModTime } from './sftpUtils'

export type { DragPayload }

const SFTP_INTERNAL_DRAG_MOVE_EVENT = 'sftp-internal-drag-move'

interface Props {
  label: string
  path: string
  entries: FileEntry[]
  selectedPaths: string[]
  paneSide: 'local' | 'remote'
  bookmarks?: SftpBookmark[]
  allowDrag?: boolean
  acceptDropFrom?: Array<'local' | 'remote'>
  wailsDropTarget?: boolean
  onNavigate: (path: string) => void
  onRowClick: (entry: FileEntry, index: number, e: React.MouseEvent) => void
  onOpenDir: (entry: FileEntry) => void
  onOpenFile?: (entry: FileEntry) => void
  onGoUp: () => void
  onContextMenu?: (e: React.MouseEvent, entry: FileEntry | null) => void
  onAddBookmark?: () => void
  onBookmarkNavigate?: (path: string) => void
  onDeleteBookmark?: (id: string) => void
  onInternalDrop?: (payload: DragPayload) => void
  onRefresh?: () => void
  refreshTitle?: string
}

/** canAcceptPayload 判断当前拖放载荷是否可接受 */
function canAcceptPayload(payload: DragPayload, acceptFrom?: Array<'local' | 'remote'>): boolean {
  if (!acceptFrom?.length) return false
  return acceptFrom.includes(payload.side)
}

/** FilePane 文件列表窗格 */
export function FilePane({
  label,
  path,
  entries,
  selectedPaths,
  paneSide,
  bookmarks = [],
  allowDrag = false,
  acceptDropFrom,
  wailsDropTarget = false,
  onNavigate,
  onRowClick,
  onOpenDir,
  onOpenFile,
  onGoUp,
  onContextMenu,
  onAddBookmark,
  onBookmarkNavigate,
  onDeleteBookmark,
  onInternalDrop,
  onRefresh,
  refreshTitle = '刷新',
}: Props) {
  const [draft, setDraft] = useState(path)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const bookmarkRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    setDraft(path)
  }, [path])

  useEffect(() => {
    if (!bookmarkOpen) return
    const close = () => setBookmarkOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [bookmarkOpen])

  useEffect(() => {
    const root = sectionRef.current
    if (!root || !onInternalDrop) return
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<DragPayload>).detail
      if (payload?.paths?.length) onInternalDrop(payload)
    }
    root.addEventListener(SFTP_INTERNAL_DROP_EVENT, handler)
    return () => root.removeEventListener(SFTP_INTERNAL_DROP_EVENT, handler)
  }, [onInternalDrop])

  useEffect(() => {
    const handler = (e: Event) => {
      if (!onInternalDrop || !acceptDropFrom?.length) {
        setDragOver(false)
        return
      }
      const detail = (e as CustomEvent<{ clientX: number; clientY: number; payload: DragPayload } | null>).detail
      if (!detail) {
        setDragOver(false)
        return
      }
      const root = sectionRef.current
      if (!root || !canAcceptPayload(detail.payload, acceptDropFrom)) {
        setDragOver(false)
        return
      }
      const rect = root.getBoundingClientRect()
      const over =
        detail.clientX >= rect.left &&
        detail.clientX <= rect.right &&
        detail.clientY >= rect.top &&
        detail.clientY <= rect.bottom
      setDragOver(over)
    }
    window.addEventListener(SFTP_INTERNAL_DRAG_MOVE_EVENT, handler)
    return () => window.removeEventListener(SFTP_INTERNAL_DRAG_MOVE_EVENT, handler)
  }, [acceptDropFrom, onInternalDrop])

  const selectedSet = new Set(selectedPaths)

  const dispatchDragMove = (clientX: number, clientY: number, payload: DragPayload | null) => {
    window.dispatchEvent(
      new CustomEvent(SFTP_INTERNAL_DRAG_MOVE_EVENT, {
        detail: payload ? { clientX, clientY, payload } : null,
      })
    )
  }

  const handleRowMouseDown = (e: React.MouseEvent, entry: FileEntry) => {
    if (!allowDrag || e.button !== 0) return
    const paths = selectedSet.has(entry.path) ? selectedPaths : [entry.path]
    const payload: DragPayload = { side: paneSide, paths }
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.hypot(dx, dy) < SFTP_DRAG_THRESHOLD) return
        dragging = true
        suppressClickRef.current = true
        beginSftpDrag(payload, ev.clientX, ev.clientY)
      }
      moveSftpDragCursor(ev.clientX, ev.clientY)
      dispatchDragMove(ev.clientX, ev.clientY, payload)
    }

    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (dragging) {
        dispatchSftpDropAt(ev.clientX, ev.clientY, payload)
        endSftpDrag()
        dispatchDragMove(0, 0, null)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const dropHint =
    acceptDropFrom?.includes('remote') && paneSide === 'local'
      ? '松开以下载到当前本地目录'
      : acceptDropFrom?.includes('local') && paneSide === 'remote'
        ? '松开以上传到当前远程目录'
        : ''

  const paneClass = [
    'sftp-pane',
    wailsDropTarget ? 'sftp-drop-target' : '',
    dragOver ? 'sftp-drop-over' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const dropEnabled = Boolean(onInternalDrop && acceptDropFrom?.length)

  return (
    <section
      ref={sectionRef}
      className={paneClass}
      {...(dropEnabled
        ? {
            'data-sftp-drop-root': '',
            'data-sftp-accept': acceptDropFrom!.join(','),
          }
        : {})}
    >
      <header className="sftp-pane-header">
        <span>{label}</span>
        <input
          className="sftp-path-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onNavigate(draft.trim())
          }}
          onBlur={() => {
            if (draft.trim() && draft !== path) onNavigate(draft.trim())
          }}
        />
        {onRefresh && (
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={refreshTitle}
            {...pressProps(() => onRefresh())}
          >
            <IconRefresh size={13} />
          </button>
        )}
        {onAddBookmark && (
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm sftp-bookmark-add"
            title="收藏当前路径"
            {...pressProps(onAddBookmark)}
          >
            ★
          </button>
        )}
        {bookmarks.length > 0 && onBookmarkNavigate && (
          <div className="sftp-bookmark-menu" ref={bookmarkRef}>
            <button
              type="button"
              className="wn-btn wn-btn-icon wn-btn-sm"
              title="路径书签"
              {...pressProps((e) => {
                e.stopPropagation()
                setBookmarkOpen((v) => !v)
              })}
            >
              ▾
            </button>
            {bookmarkOpen && (
              <div className="sftp-bookmark-dropdown" onPointerDown={(e) => e.stopPropagation()}>
                {bookmarks.map((b) => (
                  <div key={b.id} className="sftp-bookmark-item">
                    <button
                      type="button"
                      className="sftp-bookmark-link"
                      {...pressProps(() => {
                        setBookmarkOpen(false)
                        onBookmarkNavigate(b.path)
                      })}
                    >
                      {b.name}
                    </button>
                    {onDeleteBookmark && (
                      <button
                        type="button"
                        className="sftp-bookmark-del"
                        title="删除书签"
                        {...pressProps(() => onDeleteBookmark(b.id))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </header>
      <div className="sftp-pane-body" onContextMenu={(e) => onContextMenu?.(e, null)}>
        {dragOver && dropHint && <div className="sftp-drop-overlay">{dropHint}</div>}
        <table className="sftp-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>大小</th>
              <th>修改时间</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sftp-row sftp-row-parent" onDoubleClick={onGoUp}>
              <td colSpan={3}>..</td>
            </tr>
            {entries.map((f, i) => (
              <tr
                key={f.path}
                className={`sftp-row ${allowDrag ? 'sftp-row-draggable' : ''} ${selectedSet.has(f.path) ? 'selected' : ''}`}
                onMouseDown={(e) => handleRowMouseDown(e, f)}
                onClick={(e) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  onRowClick(f, i, e)
                }}
                onDoubleClick={() => {
                  if (f.isDir) onOpenDir(f)
                  else onOpenFile?.(f)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onContextMenu?.(e, f)
                }}
              >
                <td>
                  {f.isDir && <IconFolder size={13} className="sftp-icon-dir" />}
                  {f.name}
                </td>
                <td>{f.isDir ? '-' : formatBytes(f.size)}</td>
                <td>{formatModTime(f.modTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

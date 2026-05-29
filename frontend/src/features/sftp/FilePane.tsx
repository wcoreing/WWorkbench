import { useEffect, useRef, useState } from 'react'
import type { FileEntry, SftpBookmark } from '../../api/types'
import { IconFolder } from '../../components/Icons'
import { formatBytes, formatModTime } from './sftpUtils'

const DRAG_PAYLOAD_KEY = 'application/x-wnavicat-sftp-drag'
const DRAG_FROM_LOCAL = 'application/x-wnavicat-from-local'
const DRAG_FROM_REMOTE = 'application/x-wnavicat-from-remote'

export interface DragPayload {
  side: 'local' | 'remote'
  paths: string[]
}

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
}

/** canAcceptDrag 判断当前拖放是否可接受 */
function canAcceptDrag(types: readonly string[], acceptFrom?: Array<'local' | 'remote'>): boolean {
  if (!acceptFrom?.length) return false
  if (acceptFrom.includes('local') && types.includes(DRAG_FROM_LOCAL)) return true
  if (acceptFrom.includes('remote') && types.includes(DRAG_FROM_REMOTE)) return true
  return false
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
}: Props) {
  const [draft, setDraft] = useState(path)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const bookmarkRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(path)
  }, [path])

  useEffect(() => {
    if (!bookmarkOpen) return
    const close = () => setBookmarkOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [bookmarkOpen])

  const selectedSet = new Set(selectedPaths)

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selectedSet.has(entry.path) ? selectedPaths : [entry.path]
    const payload: DragPayload = { side: paneSide, paths }
    e.dataTransfer.setData(DRAG_PAYLOAD_KEY, JSON.stringify(payload))
    e.dataTransfer.setData(paneSide === 'local' ? DRAG_FROM_LOCAL : DRAG_FROM_REMOTE, '')
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!onInternalDrop || !acceptDropFrom?.length) return
    if (canAcceptDrag(e.dataTransfer.types, acceptDropFrom)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    }
  }

  const handleDragLeave = () => setDragOver(false)

  const handleDrop = (e: React.DragEvent) => {
    if (!onInternalDrop || !acceptDropFrom?.length) return
    e.preventDefault()
    setDragOver(false)
    if (!canAcceptDrag(e.dataTransfer.types, acceptDropFrom)) return
    const raw = e.dataTransfer.getData(DRAG_PAYLOAD_KEY)
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as DragPayload
      if (payload.paths?.length) onInternalDrop(payload)
    } catch {
      /* ignore */
    }
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

  return (
    <section className={paneClass}>
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
        {onAddBookmark && (
          <button type="button" className="wn-btn wn-btn-icon wn-btn-sm sftp-bookmark-add" title="收藏当前路径" onClick={onAddBookmark}>
            ★
          </button>
        )}
        {bookmarks.length > 0 && onBookmarkNavigate && (
          <div className="sftp-bookmark-menu" ref={bookmarkRef}>
            <button
              type="button"
              className="wn-btn wn-btn-icon wn-btn-sm"
              title="路径书签"
              onClick={(e) => {
                e.stopPropagation()
                setBookmarkOpen((v) => !v)
              }}
            >
              ▾
            </button>
            {bookmarkOpen && (
              <div className="sftp-bookmark-dropdown" onClick={(e) => e.stopPropagation()}>
                {bookmarks.map((b) => (
                  <div key={b.id} className="sftp-bookmark-item">
                    <button type="button" className="sftp-bookmark-link" onClick={() => { setBookmarkOpen(false); onBookmarkNavigate(b.path) }}>
                      {b.name}
                    </button>
                    {onDeleteBookmark && (
                      <button type="button" className="sftp-bookmark-del" title="删除书签" onClick={() => onDeleteBookmark(b.id)}>
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
      <div
        className="sftp-pane-body"
        onContextMenu={(e) => onContextMenu?.(e, null)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
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
                className={`sftp-row ${selectedSet.has(f.path) ? 'selected' : ''}`}
                draggable={allowDrag}
                onClick={(e) => onRowClick(f, i, e)}
                onDoubleClick={() => {
                  if (f.isDir) onOpenDir(f)
                  else onOpenFile?.(f)
                }}
                onDragStart={(e) => {
                  if (allowDrag) handleDragStart(e, f)
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

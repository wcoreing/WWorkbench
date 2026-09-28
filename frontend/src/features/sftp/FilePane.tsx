import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry, SftpBookmark } from '../../api/types'
import { IconArrowDown, IconFolder, IconPlus, IconRefresh, IconUpload, IconDownload } from '../../components/Icons'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import {
  SFTP_DRAG_THRESHOLD,
  SFTP_INTERNAL_DROP_EVENT,
  beginSftpDrag,
  dispatchSftpDropAt,
  endSftpDrag,
  moveSftpDragCursor,
  type DragPayload,
} from './sftpInternalDrag'
import { formatBytes, formatModTime, splitPathCrumbs } from './sftpUtils'

export type { DragPayload }

const SFTP_INTERNAL_DRAG_MOVE_EVENT = 'sftp-internal-drag-move'

interface Props {
  /** 侧标文案；单栏时可省略，只保留面包屑。 */
  label?: string
  path: string
  entries: FileEntry[]
  selectedPaths: string[]
  /** 传完高亮的远程路径（短暂闪一下便于验收）。 */
  flashPaths?: string[]
  paneSide: 'local' | 'remote'
  bookmarks?: SftpBookmark[]
  allowDrag?: boolean
  acceptDropFrom?: Array<'local' | 'remote'>
  wailsDropTarget?: boolean
  onNavigate: (path: string) => void
  onRowClick: (entry: FileEntry, index: number, e: React.MouseEvent) => void
  onTogglePath: (path: string) => void
  onSelectAll: (checked: boolean) => void
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
  onMkdir?: () => void
  /** 打开系统对话框多选本地文件上传。 */
  onUpload?: () => void
  /** 打开系统对话框选择本地文件夹上传。 */
  onUploadFolder?: () => void
  /** 将勾选项下载到用户选择的本地目录。 */
  onDownloadSelected?: () => void
  downloadDisabled?: boolean
  onRename?: (entry: FileEntry) => void
  onDelete?: (entry: FileEntry) => void
}

/** canAcceptPayload 判断当前拖放载荷是否可接受 */
function canAcceptPayload(payload: DragPayload, acceptFrom?: Array<'local' | 'remote'>): boolean {
  if (!acceptFrom?.length) return false
  return acceptFrom.includes(payload.side)
}

/** FilePane 宝塔式文件窗格：面包屑 + 工具栏 + 勾选表 + 悬停操作 + 底栏统计。 */
export function FilePane({
  label,
  path,
  entries,
  selectedPaths,
  flashPaths = [],
  paneSide,
  bookmarks = [],
  allowDrag = false,
  acceptDropFrom,
  wailsDropTarget = false,
  onNavigate,
  onRowClick,
  onTogglePath,
  onSelectAll,
  onOpenDir,
  onOpenFile,
  onGoUp,
  onContextMenu,
  onAddBookmark,
  onBookmarkNavigate,
  onDeleteBookmark,
  onInternalDrop,
  onRefresh,
  refreshTitle,
  onMkdir,
  onUpload,
  onUploadFolder,
  onDownloadSelected,
  downloadDisabled,
  onRename,
  onDelete,
}: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(path)
  const [query, setQuery] = useState('')
  const [pathEdit, setPathEdit] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const bookmarkRef = useRef<HTMLDivElement>(null)
  const uploadMenuRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    setDraft(path)
    setPathEdit(false)
  }, [path])

  useEffect(() => {
    if (!bookmarkOpen) return
    const close = () => setBookmarkOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [bookmarkOpen])

  useEffect(() => {
    if (!uploadMenuOpen) return
    const close = () => setUploadMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [uploadMenuOpen])

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
  const flashSet = new Set(flashPaths)
  const crumbs = useMemo(() => splitPathCrumbs(path, paneSide), [path, paneSide])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.name.toLowerCase().includes(q))
  }, [entries, query])
  const dirCount = filtered.filter((e) => e.isDir).length
  const fileCount = filtered.length - dirCount
  const allChecked = filtered.length > 0 && filtered.every((e) => selectedSet.has(e.path))
  const someChecked = filtered.some((e) => selectedSet.has(e.path))

  const dispatchDragMove = (clientX: number, clientY: number, payload: DragPayload | null) => {
    window.dispatchEvent(
      new CustomEvent(SFTP_INTERNAL_DRAG_MOVE_EVENT, {
        detail: payload ? { clientX, clientY, payload } : null,
      }),
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
      ? t('sftp.dropToDownload')
      : acceptDropFrom?.includes('local') && paneSide === 'remote'
        ? t('sftp.dropToUpload')
        : ''

  const paneClass = [
    'sftp-pane',
    'sftp-pane-bt',
    `sftp-pane-${paneSide}`,
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
      <header className="sftp-bt-chrome">
        {label ? (
          <div className="sftp-bt-side">
            <span className="sftp-bt-side-label">{label}</span>
          </div>
        ) : null}

        <nav className="sftp-bt-crumbs" aria-label={t('sftp.breadcrumb')}>
          {pathEdit ? (
            <input
              className="sftp-path-input sftp-bt-path-edit"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onNavigate(draft.trim())
                  setPathEdit(false)
                }
                if (e.key === 'Escape') {
                  setDraft(path)
                  setPathEdit(false)
                }
              }}
              onBlur={() => {
                if (draft.trim() && draft !== path) onNavigate(draft.trim())
                setPathEdit(false)
              }}
            />
          ) : (
            <>
              {crumbs.map((c, i) => (
                <span key={`${c.path}-${i}`} className="sftp-bt-crumb-wrap">
                  {i > 0 && <span className="sftp-bt-crumb-sep">›</span>}
                  <button
                    type="button"
                    className={`sftp-bt-crumb${i === crumbs.length - 1 ? ' is-current' : ''}`}
                    title={c.path}
                    {...pressProps(() => {
                      if (i < crumbs.length - 1) onNavigate(c.path)
                      else setPathEdit(true)
                    })}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </>
          )}
        </nav>
      </header>

      <div className="sftp-bt-toolbar">
        <div className="sftp-bt-toolbar-start">
          {onUpload && (
            <div className="sftp-upload-add" ref={uploadMenuRef}>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" title={t('sftp.uploadHint')} {...pressProps(onUpload)}>
                <IconUpload size={14} />
                <span>{t('sftp.upload')}</span>
              </button>
              {onUploadFolder && (
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-primary sftp-upload-add-caret"
                  title={t('sftp.uploadMore')}
                  {...pressProps((e) => {
                    e.stopPropagation()
                    setUploadMenuOpen((v) => !v)
                  })}
                >
                  <IconArrowDown size={12} />
                </button>
              )}
              {uploadMenuOpen && onUploadFolder && (
                <div className="sftp-upload-add-menu" onPointerDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="sftp-upload-add-item"
                    {...pressProps(() => {
                      setUploadMenuOpen(false)
                      onUpload()
                    })}
                  >
                    <IconUpload size={14} />
                    {t('sftp.upload')}
                  </button>
                  <button
                    type="button"
                    className="sftp-upload-add-item"
                    {...pressProps(() => {
                      setUploadMenuOpen(false)
                      onUploadFolder()
                    })}
                  >
                    <IconFolder size={14} />
                    {t('sftp.uploadFolder')}
                  </button>
                </div>
              )}
            </div>
          )}
          {onDownloadSelected && (
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-chrome"
              disabled={downloadDisabled}
              title={t('sftp.downloadHint')}
              {...pressProps(() => onDownloadSelected(), { disabled: Boolean(downloadDisabled) })}
            >
              <IconDownload size={14} />
              <span>{t('sftp.download')}</span>
            </button>
          )}
          {onMkdir && (
            <button type="button" className="wn-btn wn-btn-sm wn-btn-chrome" {...pressProps(onMkdir)}>
              <IconPlus size={14} />
              <span>{t('sftp.newFolder')}</span>
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-chrome"
              title={refreshTitle ?? t('common.refresh')}
              {...pressProps(() => onRefresh())}
            >
              <IconRefresh size={14} />
              <span>{t('common.refresh')}</span>
            </button>
          )}
          {onAddBookmark && (
            <button type="button" className="wn-btn wn-btn-sm wn-btn-chrome" title={t('sftp.bookmark')} {...pressProps(onAddBookmark)}>
              ★
              <span>{t('sftp.favorites')}</span>
            </button>
          )}
          {bookmarks.length > 0 && onBookmarkNavigate && (
            <div className="sftp-bookmark-menu" ref={bookmarkRef}>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-chrome"
                title={t('sftp.bookmarks')}
                {...pressProps((e) => {
                  e.stopPropagation()
                  setBookmarkOpen((v) => !v)
                })}
              >
                <IconArrowDown size={12} />
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
                          title={t('sftp.deleteBookmark')}
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
        </div>
        <div className="sftp-bt-toolbar-end">
          <input
            className="wn-input sftp-bt-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sftp.searchPlaceholder')}
          />
        </div>
      </div>

      <div className="sftp-pane-body" onContextMenu={(e) => onContextMenu?.(e, null)}>
        {dragOver && dropHint && <div className="sftp-drop-overlay">{dropHint}</div>}
        <table className="sftp-table sftp-table-bt">
          <thead>
            <tr>
              <th className="sftp-col-name">
                <span className="sftp-name-cell sftp-name-head">
                  <input
                    type="checkbox"
                    className="sftp-check"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked && !allChecked
                    }}
                    onChange={(e) => onSelectAll(e.target.checked)}
                    aria-label={t('sftp.selectAll')}
                  />
                  <span>{t('sftp.colName')}</span>
                </span>
              </th>
              <th className="sftp-col-size">{t('sftp.colSize')}</th>
              <th className="sftp-col-mtime">{t('sftp.colMtime')}</th>
              <th className="sftp-col-ops">{t('sftp.colOps')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sftp-row sftp-row-parent" onDoubleClick={onGoUp}>
              <td className="sftp-col-name" colSpan={4}>
                ..
              </td>
            </tr>
            {filtered.map((f, i) => {
              const selected = selectedSet.has(f.path)
              const flashed = flashSet.has(f.path)
              const entryIndex = entries.findIndex((e) => e.path === f.path)
              return (
                <tr
                  key={f.path}
                  className={`sftp-row ${allowDrag ? 'sftp-row-draggable' : ''} ${selected ? 'selected' : ''} ${flashed ? 'is-flash' : ''}`}
                  onMouseDown={(e) => handleRowMouseDown(e, f)}
                  onClick={(e) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    onRowClick(f, entryIndex >= 0 ? entryIndex : i, e)
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
                  <td className="sftp-col-name">
                    <span className="sftp-name-cell">
                      <input
                        type="checkbox"
                        className="sftp-check"
                        checked={selected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onTogglePath(f.path)}
                        aria-label={f.name}
                      />
                      {f.isDir && <IconFolder size={16} className="sftp-icon-dir" />}
                      <span className="sftp-name-text">{f.name}</span>
                    </span>
                  </td>
                  <td className="sftp-col-size">{f.isDir ? '-' : formatBytes(f.size)}</td>
                  <td className="sftp-col-mtime">{formatModTime(f.modTime)}</td>
                  <td className="sftp-col-ops" onClick={(e) => e.stopPropagation()}>
                    <div className="sftp-row-ops">
                      {f.isDir ? (
                        <button type="button" className="sftp-op" {...pressProps(() => onOpenDir(f))}>
                          {t('sftp.open')}
                        </button>
                      ) : (
                        onOpenFile && (
                          <button type="button" className="sftp-op" {...pressProps(() => onOpenFile(f))}>
                            {t('sftp.open')}
                          </button>
                        )
                      )}
                      {onRename && (
                        <button type="button" className="sftp-op" {...pressProps(() => onRename(f))}>
                          {t('sftp.rename')}
                        </button>
                      )}
                      {onDelete && (
                        <button type="button" className="sftp-op sftp-op-danger" {...pressProps(() => onDelete(f))}>
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <footer className="sftp-bt-footer">
        <span>{t('sftp.dirFileStats', { dirs: dirCount, files: fileCount })}</span>
        {selectedPaths.length > 0 && <span>{t('sftp.selectedCount', { count: selectedPaths.length })}</span>}
      </footer>
    </section>
  )
}

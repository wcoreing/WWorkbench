import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { NoteSummary, NotebookGroup } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconFolder, IconNotebook, IconPlus, IconRefresh } from '../../components/Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { pressProps } from '../../components/compat'
import {
  NOTEBOOK_ROOT_ID,
  buildNotebookTree,
  filterNotebookTree,
  type NotebookTreeNode,
} from './notebookTree'

interface Props {
  groups: NotebookGroup[]
  summaries: NoteSummary[]
  search: string
  activeTabId: string | null
  /** selectedFolderId 当前选中目录（空=根）。 */
  selectedFolderId: string
  onSelectFolder: (folderId: string) => void
  onSearchChange: (q: string) => void
  onOpenNote: (id: string) => void
  onCreateNote: (groupId: string) => void
  onCreateFolder: (parentId: string) => void
  onEditGroup: (g: NotebookGroup) => void
  onDeleteGroup: (id: string, title: string) => void
  onDeleteNote: (id: string, title: string) => void
  onMoveNoteToGroup: (noteId: string, groupId: string) => void
  onBatchDelete: (ids: string[]) => Promise<void>
  onRefresh: () => void | Promise<void>
  refreshing?: boolean
}

type CtxMenu =
  | { kind: 'folder'; x: number; y: number; group: NotebookGroup }
  | { kind: 'note'; x: number; y: number; note: NoteSummary }
  | { kind: 'root'; x: number; y: number }

/** NotebookSidebar 笔记本侧栏：目录 + 笔记文件树。 */
export function NotebookSidebar({
  groups,
  summaries,
  search,
  activeTabId,
  selectedFolderId,
  onSelectFolder,
  onSearchChange,
  onOpenNote,
  onCreateNote,
  onCreateFolder,
  onEditGroup,
  onDeleteGroup,
  onDeleteNote,
  onMoveNoteToGroup,
  onBatchDelete,
  onRefresh,
  refreshing = false,
}: Props) {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [selectedNotes, setSelectedNotes] = useState<Record<string, boolean>>({})
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const fullTree = useMemo(() => buildNotebookTree(groups, summaries), [groups, summaries])
  const tree = useMemo(() => filterNotebookTree(fullTree, search), [fullTree, search])
  const filterActive = search.trim().length > 0

  const selectionCount = useMemo(
    () => Object.keys(selectedNotes).filter((id) => selectedNotes[id]).length,
    [selectedNotes],
  )

  useEffect(() => {
    if (!filterActive) return
    const open: Record<string, boolean> = {}
    const walk = (nodes: NotebookTreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'folder') {
          open[n.id] = true
          walk(n.children)
        }
      }
    }
    walk(tree)
    setExpanded((m) => ({ ...m, ...open }))
  }, [filterActive, tree])

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [ctx])

  const toggleExpand = (id: string) => {
    setExpanded((m) => ({ ...m, [id]: !m[id] }))
  }

  useEffect(() => {
    if (selectedFolderId && !groupById.has(selectedFolderId)) onSelectFolder('')
  }, [selectedFolderId, groupById, onSelectFolder])

  /** 选中目录时自动展开，便于看到新建结果。 */
  useEffect(() => {
    if (!selectedFolderId) return
    setExpanded((m) => (m[selectedFolderId] ? m : { ...m, [selectedFolderId]: true }))
  }, [selectedFolderId])

  const toggleNoteSelected = (noteId: string, e: MouseEvent) => {
    e.stopPropagation()
    setSelectedNotes((m) => {
      const next = { ...m }
      if (next[noteId]) delete next[noteId]
      else next[noteId] = true
      return next
    })
  }

  const clearSelection = () => setSelectedNotes({})

  const runBatchDelete = async () => {
    const ids = Object.keys(selectedNotes).filter((id) => selectedNotes[id])
    if (ids.length === 0) {
      setStatusMessage(t('notebook.batchNone'))
      return
    }
    setDeleting(true)
    try {
      await onBatchDelete(ids)
      setStatusMessage(t('notebook.batchDeleted', { count: ids.length }))
      setSelectedNotes({})
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [groups],
  )

  const renderNodes = (nodes: NotebookTreeNode[], depth: number) => (
    <ul className="notebook-tree">
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          const open = expanded[n.id] ?? depth < 1
          const group = groupById.get(n.id)
          return (
            <li key={`f-${n.id}`}>
              <div
                className={`notebook-tree-folder${selectedFolderId === n.id ? ' is-selected' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => {
                  const already = selectedFolderId === n.id
                  onSelectFolder(n.id)
                  if (already) toggleExpand(n.id)
                  else setExpanded((m) => ({ ...m, [n.id]: true }))
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onSelectFolder(n.id)
                  if (group) setCtx({ kind: 'folder', x: e.clientX, y: e.clientY, group })
                }}
              >
                <span className="notebook-tree-chevron" aria-hidden>
                  <span className={`tree-chevron${open ? ' is-open' : ''}`} />
                </span>
                <span className="notebook-tree-folder-icon" aria-hidden>
                  <IconFolder size={14} />
                </span>
                <span className="notebook-tree-label">{n.name}</span>
              </div>
              {open ? renderNodes(n.children, depth + 1) : null}
            </li>
          )
        }
        const { note } = n
        const checked = !!selectedNotes[note.id]
        return (
          <li key={`n-${note.id}`}>
            <div
              className={`notebook-tree-note${activeTabId === note.id ? ' is-active' : ''}${
                checked ? ' is-batch-selected' : ''
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onOpenNote(note.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCtx({ kind: 'note', x: e.clientX, y: e.clientY, note })
              }}
            >
              {/* 与目录同行：chevron 占位 + 图标对齐，勾选放行尾避免看起来像子级 */}
              <span className="notebook-tree-chevron" aria-hidden />
              <span className="notebook-tree-note-icon" aria-hidden>
                <IconNotebook size={14} />
              </span>
              <span className="notebook-tree-label" title={note.title}>
                {note.title}
              </span>
              <input
                type="checkbox"
                className="notebook-note-check"
                checked={checked}
                onClick={(e) => toggleNoteSelected(note.id, e)}
                onChange={() => {}}
                title={t('notebook.batch')}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <section className="sidebar-section notebook-list-section">
      <div className="sidebar-header">
        <span className="sidebar-header-title">{t('notebook.listTitle')}</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={selectedFolderId ? t('notebook.newInGroup') : t('notebook.newInRoot')}
            {...pressProps(() => onCreateNote(selectedFolderId))}
          >
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={t('notebook.refresh')}
            disabled={refreshing}
            {...pressProps(() => void onRefresh(), { disabled: refreshing })}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </div>

      <div className="notebook-filter-bar">
        <input
          type="search"
          className="notebook-filter-search"
          placeholder={t('notebook.searchPlaceholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {selectionCount > 0 && (
        <div className="notebook-selection-bar">
          <span className="pane-meta">{t('notebook.selectedCount', { count: selectionCount })}</span>
          <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" {...pressProps(clearSelection)}>
            {t('notebook.batchClear')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-danger"
            disabled={deleting}
            {...pressProps(() => setDeleteConfirmOpen(true), { disabled: deleting })}
          >
            {t('notebook.batchDelete', { count: selectionCount })}
          </button>
        </div>
      )}

      <div
        className={`sidebar-body notebook-tree-body${selectionCount > 0 ? ' is-batching' : ''}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.notebook-tree-folder, .notebook-tree-note')) return
          onSelectFolder(NOTEBOOK_ROOT_ID)
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.notebook-tree-folder, .notebook-tree-note')) return
          e.preventDefault()
          onSelectFolder(NOTEBOOK_ROOT_ID)
          setCtx({ kind: 'root', x: e.clientX, y: e.clientY })
        }}
      >
        {tree.length === 0 ? (
          <div className="empty-hint">{search.trim() ? t('notebook.noMatch') : t('notebook.noNotes')}</div>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>

      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} onClick={(e) => e.stopPropagation()}>
          {ctx.kind === 'root' && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtx(null)
                  onCreateNote(NOTEBOOK_ROOT_ID)
                })}
              >
                {t('notebook.newInRoot')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtx(null)
                  onCreateFolder(NOTEBOOK_ROOT_ID)
                })}
              >
                {t('notebook.newGroup')}
              </button>
            </>
          )}
          {ctx.kind === 'folder' && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  const { group } = ctx
                  setCtx(null)
                  onCreateNote(group.id)
                })}
              >
                {t('notebook.newInGroup')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  const { group } = ctx
                  setCtx(null)
                  onCreateFolder(group.id)
                  setExpanded((m) => ({ ...m, [group.id]: true }))
                })}
              >
                {t('notebook.newSubFolder')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  const { group } = ctx
                  setCtx(null)
                  onEditGroup(group)
                })}
              >
                {t('notebook.ctxRenameGroup')}
              </button>
              <button
                type="button"
                className="wn-context-item wn-context-item-danger"
                {...pressProps(() => {
                  const { group } = ctx
                  setCtx(null)
                  onDeleteGroup(group.id, group.name)
                })}
              >
                {t('notebook.deleteGroup')}
              </button>
            </>
          )}
          {ctx.kind === 'note' && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  const { note } = ctx
                  setCtx(null)
                  onOpenNote(note.id)
                })}
              >
                {t('notebook.ctxOpen')}
              </button>
              <div className="wn-context-submenu-label">{t('notebook.ctxMoveToGroup')}</div>
              <button
                type="button"
                className="wn-context-item wn-context-item-indent"
                disabled={ctx.note.groupId === NOTEBOOK_ROOT_ID}
                onClick={() => {
                  const { note } = ctx
                  setCtx(null)
                  onMoveNoteToGroup(note.id, NOTEBOOK_ROOT_ID)
                }}
              >
                {t('notebook.rootGroup')}
              </button>
              {sortedGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="wn-context-item wn-context-item-indent"
                  disabled={g.id === ctx.note.groupId}
                  onClick={() => {
                    const { note } = ctx
                    setCtx(null)
                    onMoveNoteToGroup(note.id, g.id)
                  }}
                >
                  {g.name}
                </button>
              ))}
              <button
                type="button"
                className="wn-context-item wn-context-item-danger"
                {...pressProps(() => {
                  const { note } = ctx
                  setCtx(null)
                  onDeleteNote(note.id, note.title)
                })}
              >
                {t('notebook.ctxDeleteNote')}
              </button>
            </>
          )}
        </ContextMenu>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('notebook.batchDeleteTitle')}
        message={t('notebook.batchDeleteMsg', { count: selectionCount })}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void runBatchDelete()}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </section>
  )
}

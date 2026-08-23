import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NoteLanguage, NoteSummary, NotebookGroup } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconRefresh } from '../../components/Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { pressProps } from '../../components/compat'
import { NOTEBOOK_ROOT_ID } from './notebookTree'

const PAGE_SIZE = 40

function formatUpdatedAt(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  groups: NotebookGroup[]
  summaries: NoteSummary[]
  search: string
  activeTabId: string | null
  languages: { id: NoteLanguage; label: string }[]
  onSearchChange: (q: string) => void
  onOpenNote: (id: string) => void
  onEditGroup: (g: NotebookGroup) => void
  onDeleteGroup: (id: string, title: string) => void
  onDeleteNote: (id: string, title: string) => void
  onMoveNoteToGroup: (noteId: string, groupId: string) => void
  onBatchDelete: (ids: string[]) => Promise<void>
  onRefresh: () => void | Promise<void>
  refreshing?: boolean
}

type NoteCtxMenu = { x: number; y: number; note: NoteSummary }

function paginateList<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total: items.length,
  }
}

/** NotebookSidebar 笔记本侧栏（筛选 + 表格列表 + 分页 + 批量删除）。 */
export function NotebookSidebar({
  groups,
  summaries,
  search,
  activeTabId,
  languages,
  onSearchChange,
  onOpenNote,
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
  const [groupFilter, setGroupFilter] = useState('')
  const [langFilter, setLangFilter] = useState<NoteLanguage | ''>('')
  const [page, setPage] = useState(1)
  const [noteMenu, setNoteMenu] = useState<NoteCtxMenu | null>(null)
  const [selectedNotes, setSelectedNotes] = useState<Record<string, boolean>>({})
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [groups],
  )

  const groupLabel = useCallback(
    (groupId: string) => {
      if (groupId === NOTEBOOK_ROOT_ID) return t('notebook.rootGroup')
      return sortedGroups.find((g) => g.id === groupId)?.name ?? '—'
    },
    [sortedGroups, t],
  )

  const langLabel = useCallback(
    (id: NoteLanguage) => languages.find((l) => l.id === id)?.label ?? id,
    [languages],
  )

  const linkLabel = (n: NoteSummary) => {
    const parts: string[] = []
    if (n.sshHostId) parts.push('SSH')
    if (n.connectionId) parts.push('DB')
    return parts.length ? parts.join('·') : '—'
  }

  const filtered = useMemo(() => {
    return summaries.filter((n) => {
      if (groupFilter && n.groupId !== groupFilter) return false
      if (langFilter && n.language !== langFilter) return false
      return true
    })
  }, [summaries, groupFilter, langFilter])

  const paged = useMemo(() => paginateList(filtered, page, PAGE_SIZE), [filtered, page])
  const pageItems = paged.items
  const selectionCount = useMemo(
    () => Object.keys(selectedNotes).filter((id) => selectedNotes[id]).length,
    [selectedNotes],
  )
  const pageSelectedCount = useMemo(
    () => pageItems.filter((n) => selectedNotes[n.id]).length,
    [pageItems, selectedNotes],
  )
  const pageAllSelected = pageItems.length > 0 && pageSelectedCount === pageItems.length
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected

  const pageSelectRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = pageSomeSelected
    },
    [pageSomeSelected],
  )

  useEffect(() => {
    setPage(1)
  }, [search, groupFilter, langFilter, summaries.length])

  useEffect(() => {
    setPage((p) => Math.min(p, paged.totalPages))
  }, [paged.totalPages])

  const togglePageSelected = () => {
    if (pageAllSelected) {
      setSelectedNotes((m) => {
        const next = { ...m }
        for (const n of pageItems) delete next[n.id]
        return next
      })
      return
    }
    setSelectedNotes((m) => {
      const next = { ...m }
      for (const n of pageItems) next[n.id] = true
      return next
    })
  }

  const toggleNoteSelected = (noteId: string) => {
    setSelectedNotes((m) => {
      const next = { ...m }
      if (next[noteId]) delete next[noteId]
      else next[noteId] = true
      return next
    })
  }

  const selectAllFiltered = () => {
    const next: Record<string, boolean> = {}
    for (const n of filtered) next[n.id] = true
    setSelectedNotes(next)
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

  useEffect(() => {
    if (!noteMenu) return
    const close = () => setNoteMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [noteMenu])

  const selectedGroup = groupFilter && groupFilter !== NOTEBOOK_ROOT_ID
    ? sortedGroups.find((g) => g.id === groupFilter)
    : undefined

  const canPrev = paged.total > 0 && paged.page > 1
  const canNext = paged.total > 0 && paged.page < paged.totalPages

  return (
    <section className="sidebar-section notebook-list-section">
      <div className="sidebar-header">
        <span className="sidebar-header-title">{t('notebook.listTitle')}</span>
        <div className="sidebar-header-actions">
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
        <div className="notebook-filter-row">
          <select
            className="notebook-filter-select"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            title={t('notebook.colGroup')}
          >
            <option value="">{t('notebook.filterAllGroups')}</option>
            <option value={NOTEBOOK_ROOT_ID}>{t('notebook.rootGroup')}</option>
            {sortedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {selectedGroup && (
            <>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-xs"
                title={t('notebook.renameGroup')}
                {...pressProps(() => onEditGroup(selectedGroup))}
              >
                ✎
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-xs notebook-group-delete"
                title={t('notebook.deleteGroup')}
                {...pressProps(() => onDeleteGroup(selectedGroup.id, selectedGroup.name))}
              >
                ×
              </button>
            </>
          )}
          <select
            className="notebook-filter-select"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value as NoteLanguage | '')}
            title={t('notebook.language')}
          >
            <option value="">{t('notebook.filterAllLanguages')}</option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectionCount > 0 && (
        <div className="notebook-selection-bar">
          <span className="pane-meta">{t('notebook.selectedCount', { count: selectionCount })}</span>
          <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" {...pressProps(selectAllFiltered)}>
            {t('notebook.batchSelectAll')}
          </button>
          <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" {...pressProps(clearSelection)}>
            {t('notebook.batchClear')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-danger"
            disabled={deleting}
            {...pressProps(
              () => setDeleteConfirmOpen(true),
              { disabled: deleting },
            )}
          >
            {t('notebook.batchDelete', { count: selectionCount })}
          </button>
        </div>
      )}

      <div className="sidebar-body notebook-table-body">
        {paged.total === 0 ? (
          <div className="empty-hint">{search.trim() ? t('notebook.noMatch') : t('notebook.noNotes')}</div>
        ) : (
          <table className="notebook-note-table">
            <colgroup>
              <col className="notebook-col-check" />
              <col className="notebook-col-title" />
              <col className="notebook-col-group" />
              <col className="notebook-col-lang" />
              <col className="notebook-col-links" />
              <col className="notebook-col-updated" />
            </colgroup>
            <thead>
              <tr>
                <th className="notebook-col-check">
                  <input
                    type="checkbox"
                    className="notebook-note-check"
                    checked={pageAllSelected}
                    ref={pageSelectRef}
                    onChange={togglePageSelected}
                    title={t('notebook.batchPage')}
                  />
                </th>
                <th className="notebook-col-title">{t('notebook.colTitle')}</th>
                <th className="notebook-col-group">{t('notebook.colGroup')}</th>
                <th className="notebook-col-lang">{t('notebook.colLang')}</th>
                <th className="notebook-col-links">{t('notebook.colLinks')}</th>
                <th className="notebook-col-updated">{t('notebook.colUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((n) => {
                const checked = !!selectedNotes[n.id]
                return (
                  <tr
                    key={n.id}
                    className={`notebook-note-row${activeTabId === n.id ? ' is-active' : ''}${
                      checked ? ' is-batch-selected' : ''
                    }`}
                    onClick={() => onOpenNote(n.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setNoteMenu({ x: e.clientX, y: e.clientY, note: n })
                    }}
                  >
                    <td className="notebook-col-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="notebook-note-check"
                        checked={checked}
                        onChange={() => toggleNoteSelected(n.id)}
                      />
                    </td>
                    <td className="notebook-col-title" title={n.title}>
                      {n.title}
                    </td>
                    <td className="notebook-col-group" title={groupLabel(n.groupId)}>
                      {groupLabel(n.groupId)}
                    </td>
                    <td className="notebook-col-lang">{langLabel(n.language)}</td>
                    <td className="notebook-col-links">{linkLabel(n)}</td>
                    <td className="notebook-col-updated" title={formatUpdatedAt(n.updatedAt)}>
                      {formatUpdatedAt(n.updatedAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="pane-toolbar notebook-list-pager">
        <div className="pane-toolbar-start">
          <span className="pane-meta">
            {paged.total > 0
              ? t('common.listMeta', { total: paged.total, page: paged.page, totalPages: paged.totalPages })
              : t('common.noData')}
          </span>
        </div>
        {paged.total > 0 && (
          <div className="pane-toolbar-end">
            <button
              type="button"
              className="wn-btn wn-btn-tool wn-btn-xs"
              disabled={!canPrev}
              {...pressProps(() => setPage((p) => p - 1), { disabled: !canPrev })}
            >
              {t('common.prevPage')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-tool wn-btn-xs"
              disabled={!canNext}
              {...pressProps(() => setPage((p) => p + 1), { disabled: !canNext })}
            >
              {t('common.nextPage')}
            </button>
          </div>
        )}
      </div>

      {noteMenu && (
        <ContextMenu x={noteMenu.x} y={noteMenu.y} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const { note } = noteMenu
              setNoteMenu(null)
              onOpenNote(note.id)
            })}
          >
            {t('notebook.ctxOpen')}
          </button>
          <div className="wn-context-submenu-label">{t('notebook.ctxMoveToGroup')}</div>
          <button
            type="button"
            className="wn-context-item wn-context-item-indent"
            disabled={noteMenu.note.groupId === NOTEBOOK_ROOT_ID}
            onClick={() => {
              const { note } = noteMenu
              setNoteMenu(null)
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
              disabled={g.id === noteMenu.note.groupId}
              onClick={() => {
                const { note } = noteMenu
                setNoteMenu(null)
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
              const { note } = noteMenu
              setNoteMenu(null)
              onDeleteNote(note.id, note.title)
            })}
          >
            {t('notebook.ctxDeleteNote')}
          </button>
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

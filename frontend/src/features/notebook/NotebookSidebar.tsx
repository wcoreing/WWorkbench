import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NoteLanguage, NoteSummary, NotebookGroup } from '../../api/types'
import { IconNotebook, IconPlus } from '../../components/Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { useI18n } from '../../i18n'
import { pressProps } from '../../components/compat'
import {
  NOTEBOOK_DRAG_MIME,
  NOTEBOOK_ROOT_ID,
  buildNotebookLayout,
  moveGroupBefore,
  moveNoteInTree,
  notesInGroup,
  orderedGroups,
  parseNotebookDrag,
  type NotebookDragPayload,
} from './notebookTree'

export type NotebookDropHint =
  | { kind: 'group-before'; groupId: string }
  | { kind: 'note-before'; groupId: string; noteId: string }
  | { kind: 'group-append'; groupId: string }

interface Props {
  groups: NotebookGroup[]
  summaries: NoteSummary[]
  searching: boolean
  search: string
  activeTabId: string | null
  collapsedGroups: Set<string>
  languages: { id: NoteLanguage; label: string }[]
  onSearchChange: (q: string) => void
  onToggleGroup: (id: string) => void
  onOpenNote: (id: string) => void
  onGroupsChange: (groups: NotebookGroup[]) => void
  onSummariesChange: (summaries: NoteSummary[]) => void
  onPersistLayout: (layout: ReturnType<typeof buildNotebookLayout>) => Promise<void>
  onCreateNoteInGroup: (groupId: string) => void
  onEditGroup: (g: NotebookGroup) => void
  onDeleteGroup: (id: string, title: string) => void
  onDeleteNote: (id: string, title: string) => void
  onMoveNoteToGroup: (noteId: string, groupId: string) => void
}

type NoteCtxMenu = { x: number; y: number; note: NoteSummary }
type GroupCtxMenu = { x: number; y: number; group: NotebookGroup }

/** NotebookSidebar 笔记本侧栏（分组树 + 拖拽排序/跨组移动）。 */
export function NotebookSidebar({
  groups,
  summaries,
  searching,
  search,
  activeTabId,
  collapsedGroups,
  languages,
  onSearchChange,
  onToggleGroup,
  onOpenNote,
  onGroupsChange,
  onSummariesChange,
  onPersistLayout,
  onCreateNoteInGroup,
  onEditGroup,
  onDeleteGroup,
  onDeleteNote,
  onMoveNoteToGroup,
}: Props) {
  const { t } = useI18n()
  const [dropHint, setDropHint] = useState<NotebookDropHint | null>(null)
  const [dragging, setDragging] = useState<NotebookDragPayload | null>(null)
  const [noteMenu, setNoteMenu] = useState<NoteCtxMenu | null>(null)
  const [groupMenu, setGroupMenu] = useState<GroupCtxMenu | null>(null)

  useEffect(() => {
    if (!noteMenu && !groupMenu) return
    const close = () => {
      setNoteMenu(null)
      setGroupMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [noteMenu, groupMenu])

  const sortedGroups = useMemo(() => orderedGroups(groups), [groups])

  const clearDrop = useCallback(() => setDropHint(null), [])

  const applyTree = useCallback(
    async (nextGroups: NotebookGroup[], nextSummaries: NoteSummary[]) => {
      onGroupsChange(nextGroups)
      onSummariesChange(nextSummaries)
      const layout = buildNotebookLayout(nextGroups, nextSummaries)
      await onPersistLayout(layout)
    },
    [onGroupsChange, onSummariesChange, onPersistLayout],
  )

  const onDragStart = (payload: NotebookDragPayload) => (e: React.DragEvent) => {
    e.dataTransfer.setData(NOTEBOOK_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
    setDragging(payload)
  }

  const onDragEnd = () => {
    setDragging(null)
    clearDrop()
  }

  const readPayload = (e: React.DragEvent): NotebookDragPayload | null => {
    const raw = e.dataTransfer.getData(NOTEBOOK_DRAG_MIME)
    return parseNotebookDrag(raw)
  }

  const handleGroupDropBefore = async (e: React.DragEvent, beforeGroupId: string) => {
    e.preventDefault()
    const payload = readPayload(e)
    if (!payload) return
    clearDrop()
    setDragging(null)
    if (payload.kind === 'group') {
      const nextGroups = moveGroupBefore(groups, payload.id, beforeGroupId)
      await applyTree(nextGroups, summaries)
      return
    }
    const first = notesInGroup(summaries, beforeGroupId)[0]?.id ?? null
    const nextSummaries = moveNoteInTree(summaries, payload.id, beforeGroupId, first)
    await applyTree(groups, nextSummaries)
  }

  const handleNoteDropBefore = async (
    e: React.DragEvent,
    groupId: string,
    beforeNoteId: string,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const payload = readPayload(e)
    if (!payload || payload.kind !== 'note') return
    clearDrop()
    setDragging(null)
    if (payload.id === beforeNoteId) return
    const nextSummaries = moveNoteInTree(summaries, payload.id, groupId, beforeNoteId)
    await applyTree(groups, nextSummaries)
  }

  const handleGroupAppend = async (e: React.DragEvent, groupId: string) => {
    e.preventDefault()
    const payload = readPayload(e)
    if (!payload || payload.kind !== 'note') return
    clearDrop()
    setDragging(null)
    const nextSummaries = moveNoteInTree(summaries, payload.id, groupId, null)
    await applyTree(groups, nextSummaries)
  }

  const renderNoteItem = (n: NoteSummary, groupId: string) => {
    const hintBefore =
      dropHint?.kind === 'note-before' &&
      dropHint.groupId === groupId &&
      dropHint.noteId === n.id
    return (
      <li
        key={n.id}
        className={`conn-item notebook-note-item${activeTabId === n.id ? ' active' : ''}${
          dragging?.kind === 'note' && dragging.id === n.id ? ' is-dragging' : ''
        }${hintBefore ? ' drop-before' : ''}`}
        draggable
        onDragStart={onDragStart({ kind: 'note', id: n.id })}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!dragging || dragging.kind !== 'note') return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropHint({ kind: 'note-before', groupId, noteId: n.id })
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          if (dropHint?.kind === 'note-before' && dropHint.noteId === n.id) clearDrop()
        }}
        onDrop={(e) => void handleNoteDropBefore(e, groupId, n.id)}
        onClick={() => onOpenNote(n.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setGroupMenu(null)
          setNoteMenu({ x: e.clientX, y: e.clientY, note: n })
        }}
      >
        <span className="notebook-drag-handle" title={t('notebook.dragHint')} aria-hidden>
          ⋮⋮
        </span>
        <IconNotebook size={14} className="mock-icon" />
        <div className="conn-meta">
          <span className="conn-name">{n.title}</span>
          <span className="conn-host">
            {languages.find((l) => l.id === n.language)?.label}
            {n.sshHostId ? ' · SSH' : ''}
            {n.connectionId ? ' · DB' : ''}
          </span>
        </div>
      </li>
    )
  }

  return (
    <aside className="app-sidebar notebook-sidebar">
      <div className="notebook-search">
        <input
          type="search"
          placeholder={t('notebook.searchPlaceholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {searching ? (
        <section className="sidebar-section">
          <div className="sidebar-header">
            <span>{t('notebook.searchResults', { count: summaries.length })}</span>
          </div>
          <div className="sidebar-body">
            {summaries.length === 0 ? (
              <div className="empty-hint">{t('notebook.noMatch')}</div>
            ) : (
              <ul className="conn-list notebook-note-list">
                {summaries.map((n) => renderNoteItem(n, n.groupId))}
              </ul>
            )}
          </div>
          <p className="notebook-dnd-hint">{t('notebook.searchNoDrag')}</p>
        </section>
      ) : (
        <>
          <p className="notebook-dnd-hint">{t('notebook.dragHint')}</p>
          {(() => {
            const rootNotes = notesInGroup(summaries, NOTEBOOK_ROOT_ID)
            const rootCollapsed = collapsedGroups.has(NOTEBOOK_ROOT_ID)
            const hintRootAppend =
              dropHint?.kind === 'group-append' && dropHint.groupId === NOTEBOOK_ROOT_ID
            return (
              <section className="sidebar-section notebook-group-section notebook-root-section">
                <div className="sidebar-header notebook-group-header">
                  <button
                    type="button"
                    className="notebook-group-toggle"
                    onClick={() => onToggleGroup(NOTEBOOK_ROOT_ID)}
                  >
                    <span className={`tree-chevron${rootCollapsed ? '' : ' is-open'}`} aria-hidden />
                    {t('notebook.rootGroup')}
                  </button>
                  <button
                    type="button"
                    className="wn-btn wn-btn-icon wn-btn-sm"
                    title={t('notebook.newInRoot')}
                    onClick={() => onCreateNoteInGroup(NOTEBOOK_ROOT_ID)}
                  >
                    <IconPlus size={14} />
                  </button>
                </div>
                {!rootCollapsed && (
                  <div
                    className={`sidebar-body notebook-group-body${hintRootAppend ? ' drop-append' : ''}`}
                    onDragOver={(e) => {
                      if (dragging?.kind !== 'note') return
                      e.preventDefault()
                      e.stopPropagation()
                      setDropHint({ kind: 'group-append', groupId: NOTEBOOK_ROOT_ID })
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return
                      if (dropHint?.kind === 'group-append' && dropHint.groupId === NOTEBOOK_ROOT_ID) {
                        clearDrop()
                      }
                    }}
                    onDrop={(e) => void handleGroupAppend(e, NOTEBOOK_ROOT_ID)}
                  >
                    {rootNotes.length === 0 ? (
                      <div className="empty-hint notebook-group-empty-drop">
                        {dragging?.kind === 'note' ? t('notebook.dropHere') : t('notebook.noNotes')}
                      </div>
                    ) : (
                      <ul className="conn-list notebook-note-list">
                        {rootNotes.map((n) => renderNoteItem(n, NOTEBOOK_ROOT_ID))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )
          })()}
          {sortedGroups.map((g) => {
            const notes = notesInGroup(summaries, g.id)
            const collapsed = collapsedGroups.has(g.id)
            const hintGroupBefore =
              dropHint?.kind === 'group-before' && dropHint.groupId === g.id
            const hintAppend =
              dropHint?.kind === 'group-append' && dropHint.groupId === g.id
            return (
              <section
                key={g.id}
                className={`sidebar-section notebook-group-section${
                  dragging?.kind === 'group' && dragging.id === g.id ? ' is-dragging' : ''
                }`}
                onDragOver={(e) => {
                  if (dragging?.kind !== 'group') return
                  e.preventDefault()
                  setDropHint({ kind: 'group-before', groupId: g.id })
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return
                  if (dropHint?.kind === 'group-before' && dropHint.groupId === g.id) clearDrop()
                }}
                onDrop={(e) => void handleGroupDropBefore(e, g.id)}
              >
                <div
                  className={`sidebar-header notebook-group-header${hintGroupBefore ? ' drop-before' : ''}`}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setNoteMenu(null)
                    setGroupMenu({ x: e.clientX, y: e.clientY, group: g })
                  }}
                >
                  <button type="button" className="notebook-group-toggle" onClick={() => onToggleGroup(g.id)}>
                    <span className={`tree-chevron${collapsed ? '' : ' is-open'}`} aria-hidden />
                    {g.name}
                  </button>
                  <span
                    className="notebook-group-drag-handle"
                    title={t('notebook.dragGroupHint')}
                    draggable
                    onDragStart={onDragStart({ kind: 'group', id: g.id })}
                    onDragEnd={onDragEnd}
                  >
                    ⋮⋮
                  </span>
                  <button
                    type="button"
                    className="wn-btn wn-btn-icon wn-btn-sm"
                    title={t('notebook.renameGroup')}
                    onClick={() => onEditGroup(g)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="wn-btn wn-btn-icon wn-btn-sm"
                    title={t('notebook.newInGroup')}
                    onClick={() => onCreateNoteInGroup(g.id)}
                  >
                    <IconPlus size={14} />
                  </button>
                  <button
                    type="button"
                    className="wn-btn wn-btn-icon wn-btn-sm notebook-group-delete"
                    title={t('notebook.deleteGroup')}
                    onClick={() => onDeleteGroup(g.id, g.name)}
                  >
                    ×
                  </button>
                </div>
                {!collapsed && (
                  <div
                    className={`sidebar-body notebook-group-body${hintAppend ? ' drop-append' : ''}`}
                    onDragOver={(e) => {
                      if (dragging?.kind !== 'note') return
                      e.preventDefault()
                      e.stopPropagation()
                      setDropHint({ kind: 'group-append', groupId: g.id })
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return
                      if (dropHint?.kind === 'group-append' && dropHint.groupId === g.id) clearDrop()
                    }}
                    onDrop={(e) => void handleGroupAppend(e, g.id)}
                  >
                    {notes.length === 0 ? (
                      <div className="empty-hint notebook-group-empty-drop">
                        {dragging?.kind === 'note' ? t('notebook.dropHere') : t('notebook.noNotes')}
                      </div>
                    ) : (
                      <ul className="conn-list notebook-note-list">{notes.map((n) => renderNoteItem(n, g.id))}</ul>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </>
      )}

      {noteMenu && (
        <ContextMenu
          x={noteMenu.x}
          y={noteMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
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

      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const { group } = groupMenu
              setGroupMenu(null)
              onEditGroup(group)
            })}
          >
            {t('notebook.ctxRenameGroup')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const { group } = groupMenu
              setGroupMenu(null)
              onCreateNoteInGroup(group.id)
            })}
          >
            {t('notebook.newInGroup')}
          </button>
          <button
            type="button"
            className="wn-context-item wn-context-item-danger"
            {...pressProps(() => {
              const { group } = groupMenu
              setGroupMenu(null)
              onDeleteGroup(group.id, group.name)
            })}
          >
            {t('notebook.deleteGroup')}
          </button>
        </ContextMenu>
      )}
    </aside>
  )
}

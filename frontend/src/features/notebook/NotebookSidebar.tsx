import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { NoteRole, NoteSummary, NotebookGroup } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconFolder, IconNotebook, IconPlus, IconRefresh } from '../../components/Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { pressProps } from '../../components/compat'
import { extForLanguage } from './noteFileTypes'
import {
  NOTEBOOK_ROOT_ID,
  buildNotebookTree,
  filterNotebookTree,
  type NotebookTreeNode,
} from './notebookTree'
import {
  basenameRel,
  canMoveInto,
  joinRel,
  opRelForNote,
  uniqueSiblingName,
  type NotebookClipboard,
  type NotebookInlineEdit,
} from './notebookPathOps'

interface Props {
  groups: NotebookGroup[]
  summaries: NoteSummary[]
  search: string
  activeTabId: string | null
  selectedFolderId: string
  roleFilter: '' | NoteRole
  onRoleFilterChange: (role: '' | NoteRole) => void
  onSelectFolder: (folderId: string) => void
  onSearchChange: (q: string) => void
  onOpenNote: (id: string) => void
  onDeleteGroup: (id: string, title: string) => void
  onDeleteNote: (id: string, title: string) => void
  onMakeNoteRole: (noteId: string, role: NoteRole) => void
  onBatchDelete: (ids: string[]) => Promise<void>
  onRefresh: () => void | Promise<void>
  onRevealWorkspace?: () => void | Promise<void>
  onRevealPath: (rel: string) => void | Promise<void>
  onRenamePath: (rel: string, newName: string) => Promise<void>
  onMovePath: (fromRel: string, destDirRel: string) => Promise<void>
  onCopyPath: (fromRel: string, destDirRel: string) => Promise<void>
  onCreateDirInline: (parentRel: string, name: string) => Promise<void>
  onCreateFileInline: (parentRel: string, name: string) => Promise<void>
  refreshing?: boolean
}

type CtxMenu =
  | { kind: 'folder'; x: number; y: number; group: NotebookGroup }
  | { kind: 'note'; x: number; y: number; note: NoteSummary }
  | { kind: 'root'; x: number; y: number }

const PROTECTED = new Set(['工作流', '记忆区'])

/** NotebookSidebar 笔记本侧栏：目录 + 笔记文件树（真路径操作）。 */
export function NotebookSidebar({
  groups,
  summaries,
  search,
  activeTabId,
  selectedFolderId,
  roleFilter,
  onRoleFilterChange,
  onSelectFolder,
  onSearchChange,
  onOpenNote,
  onDeleteGroup,
  onDeleteNote,
  onMakeNoteRole,
  onBatchDelete,
  onRefresh,
  onRevealWorkspace,
  onRevealPath,
  onRenamePath,
  onMovePath,
  onCopyPath,
  onCreateDirInline,
  onCreateFileInline,
  refreshing = false,
}: Props) {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [selectedNotes, setSelectedNotes] = useState<Record<string, boolean>>({})
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [inline, setInline] = useState<NotebookInlineEdit | null>(null)
  const [clipboard, setClipboard] = useState<NotebookClipboard | null>(null)
  const [dropOver, setDropOver] = useState('')
  const inlineRef = useRef<HTMLInputElement>(null)

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const roleSummaries = useMemo(() => {
    if (!roleFilter) return summaries
    return summaries.filter((n) => {
      const role = n.role || 'note'
      return role === roleFilter
    })
  }, [summaries, roleFilter])
  const fullTree = useMemo(() => buildNotebookTree(groups, roleSummaries), [groups, roleSummaries])
  const tree = useMemo(() => filterNotebookTree(fullTree, search), [fullTree, search])
  const filterActive = search.trim().length > 0 || Boolean(roleFilter)

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
    setExpanded((m) => {
      let changed = false
      for (const id of Object.keys(open)) {
        if (!m[id]) {
          changed = true
          break
        }
      }
      return changed ? { ...m, ...open } : m
    })
  }, [filterActive, tree])

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [ctx])

  useEffect(() => {
    if (selectedFolderId && !groupById.has(selectedFolderId)) onSelectFolder('')
  }, [selectedFolderId, groupById, onSelectFolder])

  useEffect(() => {
    if (!selectedFolderId) return
    setExpanded((m) => (m[selectedFolderId] ? m : { ...m, [selectedFolderId]: true }))
  }, [selectedFolderId])

  useEffect(() => {
    if (!inline) return
    const t = window.setTimeout(() => inlineRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [inline])

  const toggleExpand = (id: string) => {
    setExpanded((m) => ({ ...m, [id]: !m[id] }))
  }

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

  const beginInlineCreate = (parent: string, isDir: boolean) => {
    setCtx(null)
    if (parent) setExpanded((m) => ({ ...m, [parent]: true }))
    const def = isDir ? t('notebook.untitledFolder') : `${t('notebook.untitledNote')}.md`
    setInline({
      kind: 'create',
      parent,
      isDir,
      value: uniqueSiblingName(siblingNamesFor(parent), def),
    })
  }

  const siblingNamesFor = (parent: string) => {
    const kids = groups.filter((g) => (g.parentId || '') === (parent || '')).map((g) => g.name)
    const notes = summaries
      .filter((n) => (n.groupId || '') === (parent || ''))
      .map((n) => `${n.title}${extForLanguage(n.language) || '.md'}`)
    return [...kids, ...notes]
  }

  const beginRename = (rel: string) => {
    setCtx(null)
    setInline({ kind: 'rename', rel, value: basenameRel(rel) })
  }

  const cancelInline = () => setInline(null)

  const commitInline = async () => {
    if (!inline) return
    const name = inline.value.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      setStatusMessage(t('notebook.invalidName'))
      return
    }
    try {
      if (inline.kind === 'rename') {
        if (name === basenameRel(inline.rel)) {
          setInline(null)
          return
        }
        await onRenamePath(inline.rel, name)
        setStatusMessage(t('notebook.renamedPath', { name }))
      } else if (inline.isDir) {
        await onCreateDirInline(inline.parent, name)
        setExpanded((m) => ({ ...m, [inline.parent]: true, [joinRel(inline.parent, name)]: true }))
        setStatusMessage(t('notebook.createdGroup', { name }))
      } else {
        await onCreateFileInline(inline.parent, name)
        setStatusMessage(t('notebook.created'))
      }
      setInline(null)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const onInlineKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitInline()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelInline()
    }
  }

  const pasteParent = () => {
    if (selectedFolderId) return selectedFolderId
    return NOTEBOOK_ROOT_ID
  }

  const cutRels = (rels: string[]) => {
    setCtx(null)
    if (!rels.length) return
    setClipboard({ mode: 'cut', rels })
    setStatusMessage(t('notebook.cutItems', { count: rels.length }))
  }

  const copyRels = (rels: string[]) => {
    setCtx(null)
    if (!rels.length) return
    setClipboard({ mode: 'copy', rels })
    setStatusMessage(t('notebook.copiedItems', { count: rels.length }))
  }

  const pasteClipboard = async (dest?: string) => {
    setCtx(null)
    if (!clipboard?.rels.length) {
      setStatusMessage(t('notebook.clipboardEmpty'))
      return
    }
    const destDir = dest ?? pasteParent()
    try {
      for (const from of clipboard.rels) {
        if (clipboard.mode === 'cut') {
          if (!canMoveInto(from, destDir)) continue
          await onMovePath(from, destDir)
        } else {
          await onCopyPath(from, destDir)
        }
      }
      if (clipboard.mode === 'cut') setClipboard(null)
      if (destDir) setExpanded((m) => ({ ...m, [destDir]: true }))
      setStatusMessage(t('notebook.pastedItems'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const onDragStart = (rel: string, e: DragEvent) => {
    e.dataTransfer.setData('text/wwb-notebook-rel', rel)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOverFolder = (folderId: string, e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropOver(folderId)
  }

  const onDropFolder = async (folderId: string, e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropOver('')
    const from = e.dataTransfer.getData('text/wwb-notebook-rel')
    if (!from || !canMoveInto(from, folderId)) return
    try {
      await onMovePath(from, folderId)
      setExpanded((m) => ({ ...m, [folderId]: true }))
      setStatusMessage(t('notebook.movedPath'))
    } catch (err) {
      setStatusMessage((err as Error).message)
    }
  }

  const renderInline = (key: string) => {
    if (!inline) return null
    if (inline.kind === 'rename' && inline.rel !== key) return null
    if (inline.kind === 'create' && joinRel(inline.parent, '__creating__') !== key) return null
    return (
      <input
        ref={inlineRef}
        className="notebook-tree-inline"
        value={inline.value}
        onChange={(e) => setInline({ ...inline, value: e.target.value })}
        onBlur={() => void commitInline()}
        onKeyDown={onInlineKey}
        onClick={(e) => e.stopPropagation()}
      />
    )
  }

  const renderCreateRow = (parent: string, depth: number) => {
    if (!inline || inline.kind !== 'create' || inline.parent !== parent) return null
    return (
      <li key={`create-${parent}`}>
        <div className="notebook-tree-note is-inline" style={{ paddingLeft: 8 + depth * 14 }}>
          <span className="notebook-tree-chevron" aria-hidden />
          <span className="notebook-tree-note-icon" aria-hidden>
            {inline.isDir ? <IconFolder size={14} /> : <IconNotebook size={14} />}
          </span>
          <input
            ref={inlineRef}
            className="notebook-tree-inline"
            value={inline.value}
            onChange={(e) => setInline({ ...inline, value: e.target.value })}
            onBlur={() => void commitInline()}
            onKeyDown={onInlineKey}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </li>
    )
  }

  const renderNodes = (nodes: NotebookTreeNode[], depth: number, parentId: string) => (
    <ul className="notebook-tree">
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          const open = expanded[n.id] ?? depth < 1
          const group = groupById.get(n.id)
          const renaming = inline?.kind === 'rename' && inline.rel === n.id
          return (
            <li key={`f-${n.id}`}>
              <div
                className={`notebook-tree-folder${selectedFolderId === n.id ? ' is-selected' : ''}${
                  dropOver === n.id ? ' is-drop-over' : ''
                }`}
                style={{ paddingLeft: 8 + depth * 14 }}
                draggable={!PROTECTED.has(n.id)}
                onDragStart={(e) => onDragStart(n.id, e)}
                onDragOver={(e) => onDragOverFolder(n.id, e)}
                onDragLeave={() => setDropOver((cur) => (cur === n.id ? '' : cur))}
                onDrop={(e) => void onDropFolder(n.id, e)}
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
                {renaming ? (
                  renderInline(n.id)
                ) : (
                  <span className="notebook-tree-label">{n.name}</span>
                )}
              </div>
              {open ? (
                <>
                  {renderNodes(n.children, depth + 1, n.id)}
                  {renderCreateRow(n.id, depth + 1)}
                </>
              ) : null}
            </li>
          )
        }
        const { note } = n
        const checked = !!selectedNotes[note.id]
        const opRel = opRelForNote(note.id)
        const renaming = inline?.kind === 'rename' && inline.rel === opRel
        return (
          <li key={`n-${note.id}`}>
            <div
              className={`notebook-tree-note${activeTabId === note.id ? ' is-active' : ''}${
                checked ? ' is-batch-selected' : ''
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
              draggable
              onDragStart={(e) => onDragStart(opRel, e)}
              onClick={() => onOpenNote(note.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCtx({ kind: 'note', x: e.clientX, y: e.clientY, note })
              }}
            >
              <span className="notebook-tree-chevron" aria-hidden />
              <span className="notebook-tree-note-icon" aria-hidden>
                <IconNotebook size={14} />
              </span>
              {note.role && note.role !== 'note' && (
                <span
                  className={`notebook-role-badge is-${note.role}`}
                  title={
                    note.role === 'memory' ? t('notebook.roleMemory') : t('notebook.roleSkill')
                  }
                >
                  {note.role === 'memory'
                    ? t('notebook.roleBadgeMemory')
                    : t('notebook.roleBadgeSkill')}
                </span>
              )}
              {renaming ? (
                renderInline(opRel)
              ) : (
                <span className="notebook-tree-label" title={`${note.title}${extForLanguage(note.language)}`}>
                  {note.title}
                  <span className="notebook-tree-ext">{extForLanguage(note.language)}</span>
                </span>
              )}
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
      {depth === 0 ? renderCreateRow(parentId, depth) : null}
    </ul>
  )

  return (
    <section className="sidebar-section notebook-list-section">
      <div className="sidebar-header notebook-explorer-header">
        <button
          type="button"
          className="sidebar-header-title is-button"
          title={t('notebook.revealWorkspace')}
          {...pressProps(() => {
            if (onRevealWorkspace) void onRevealWorkspace()
          })}
        >
          {t('notebook.explorerTitle')}
        </button>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={t('notebook.newFile')}
            {...pressProps(() => beginInlineCreate(selectedFolderId || NOTEBOOK_ROOT_ID, false))}
          >
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={t('notebook.newGroup')}
            {...pressProps(() => beginInlineCreate(selectedFolderId || NOTEBOOK_ROOT_ID, true))}
          >
            <IconFolder size={14} />
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
        <div className="notebook-role-filters" role="tablist" aria-label={t('notebook.roleFilter')}>
          {(
            [
              ['', t('notebook.roleFilterAll')],
              ['memory', t('notebook.roleBadgeMemory')],
              ['skill', t('notebook.roleBadgeSkill')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id || 'all'}
              type="button"
              role="tab"
              aria-selected={roleFilter === id}
              className={`notebook-role-filter${roleFilter === id ? ' is-on' : ''}`}
              {...pressProps(() => onRoleFilterChange(id))}
            >
              {label}
            </button>
          ))}
        </div>
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
        onDragOver={(e) => {
          e.preventDefault()
          setDropOver(NOTEBOOK_ROOT_ID)
        }}
        onDrop={(e) => void onDropFolder(NOTEBOOK_ROOT_ID, e)}
      >
        {tree.length === 0 && !(inline && inline.kind === 'create' && !inline.parent) ? (
          <div className="empty-hint">{search.trim() ? t('notebook.noMatch') : t('notebook.noNotes')}</div>
        ) : (
          renderNodes(tree, 0, NOTEBOOK_ROOT_ID)
        )}
      </div>

      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} onClick={(e) => e.stopPropagation()}>
          {ctx.kind === 'root' && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => beginInlineCreate(NOTEBOOK_ROOT_ID, false))}
              >
                {t('notebook.newInRoot')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => beginInlineCreate(NOTEBOOK_ROOT_ID, true))}
              >
                {t('notebook.newGroup')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                disabled={!clipboard}
                {...pressProps(() => void pasteClipboard(NOTEBOOK_ROOT_ID), { disabled: !clipboard })}
              >
                {t('notebook.ctxPaste')}
              </button>
            </>
          )}
          {ctx.kind === 'folder' && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => beginInlineCreate(ctx.group.id, false))}
              >
                {t('notebook.newInGroup')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => beginInlineCreate(ctx.group.id, true))}
              >
                {t('notebook.newSubFolder')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                disabled={PROTECTED.has(ctx.group.id)}
                {...pressProps(() => beginRename(ctx.group.id), {
                  disabled: PROTECTED.has(ctx.group.id),
                })}
              >
                {t('notebook.ctxRename')}
              </button>
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                disabled={PROTECTED.has(ctx.group.id)}
                {...pressProps(() => cutRels([ctx.group.id]), {
                  disabled: PROTECTED.has(ctx.group.id),
                })}
              >
                {t('notebook.ctxCut')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => copyRels([ctx.group.id]))}
              >
                {t('notebook.ctxCopy')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                disabled={!clipboard}
                {...pressProps(() => void pasteClipboard(ctx.group.id), { disabled: !clipboard })}
              >
                {t('notebook.ctxPaste')}
              </button>
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtx(null)
                  void onRevealPath(ctx.group.id)
                })}
              >
                {t('notebook.revealInFinder')}
              </button>
              <button
                type="button"
                className="wn-context-item wn-context-item-danger"
                disabled={PROTECTED.has(ctx.group.id)}
                {...pressProps(() => {
                  const { group } = ctx
                  setCtx(null)
                  onDeleteGroup(group.id, group.name)
                }, { disabled: PROTECTED.has(ctx.group.id) })}
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
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => beginRename(opRelForNote(ctx.note.id)))}
              >
                {t('notebook.ctxRename')}
              </button>
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => cutRels([opRelForNote(ctx.note.id)]))}
              >
                {t('notebook.ctxCut')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => copyRels([opRelForNote(ctx.note.id)]))}
              >
                {t('notebook.ctxCopy')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                disabled={!clipboard}
                {...pressProps(() => void pasteClipboard(ctx.note.groupId || NOTEBOOK_ROOT_ID), {
                  disabled: !clipboard,
                })}
              >
                {t('notebook.ctxPaste')}
              </button>
              <div className="wn-context-sep" />
              <div className="wn-context-submenu-label">{t('notebook.ctxMakeAs')}</div>
              {(
                [
                  { role: 'memory' as const, label: t('notebook.ctxMakeMemory') },
                  { role: 'skill' as const, label: t('notebook.ctxMakeSkill') },
                  { role: 'note' as const, label: t('notebook.ctxMakeNote') },
                ] as const
              ).map((item) => (
                <button
                  key={item.role}
                  type="button"
                  className="wn-context-item wn-context-item-indent"
                  disabled={(ctx.note.role || 'note') === item.role}
                  {...pressProps(() => {
                    const { note } = ctx
                    setCtx(null)
                    onMakeNoteRole(note.id, item.role)
                  })}
                >
                  {item.label}
                </button>
              ))}
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtx(null)
                  void onRevealPath(ctx.note.id)
                })}
              >
                {t('notebook.revealInFinder')}
              </button>
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

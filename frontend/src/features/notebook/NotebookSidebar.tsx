import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { api } from '../../api/client'
import type { HostProject, NoteRole, NoteSummary, NotebookGroup } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconFolder, IconPlus, IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { pressProps } from '../../components/compat'
import { ResourceTags, type ResourceTag } from '../../tags'
import { DirVersionModal } from './DirVersionModal'
import { NOTEBOOK_ROOT_OPS, isMemoryProjectDir, isSystemNotebookRoot } from './businessRoots'
import {
  NOTEBOOK_DRAG_MIME,
  NOTEBOOK_ROOT_ID,
  buildNotebookTree,
  filterNotebookTree,
  findNotebookSubtree,
  type NotebookTreeNode,
} from './notebookTree'
import { beginAssetDrag } from '../agent/agentAssetDrag'
import { mentionNote } from '../agent/openAgentDraft'
import {
  TAG_FOCUS_WORKFLOW,
  TAG_OPEN_MEMORY_NOTE,
  TAG_OPEN_VERSION_HISTORY,
  resolveFolderResourceTags,
  resolveNoteResourceTags,
} from './notebookResourceTags'
import {
  basenameRel,
  canMoveInto,
  joinRel,
  opRelForNote,
  uniqueSiblingName,
  type NotebookClipboard,
  type NotebookInlineEdit,
} from './notebookPathOps'
import { useHostProjectBinding } from './useHostProjectBinding'
import {
  NotebookSidebarContextMenu,
  type NotebookSidebarCtxMenu,
} from './NotebookSidebarContextMenu'
import { NotebookSidebarTree } from './NotebookSidebarTree'

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
  /** 只展示该目录子树（单根；与 scopeRootIds 二选一，多根优先）。 */
  scopeRootId?: string
  /** 并列展示多个业务工作根（如运维壳：记忆区 + 运维）。 */
  scopeRootIds?: readonly string[]
  /** 紧凑：藏搜索/角色筛选，适合嵌在 NotebookIDE。 */
  compact?: boolean
  /** 记忆区项目绑定（dirRel → 本地/远端路径）。 */
  projectByDir?: Record<string, HostProject>
  onProjectBindingChanged?: () => void | Promise<void>
  /** 多选笔记后「生成整理页」（运维壳挂载）。 */
  onComposeBrief?: (noteIds: string[]) => void
}

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
  scopeRootId = '',
  scopeRootIds,
  compact = false,
  projectByDir = {},
  onProjectBindingChanged,
  onComposeBrief,
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [ctx, setCtx] = useState<NotebookSidebarCtxMenu | null>(null)
  const [selectedNotes, setSelectedNotes] = useState<Record<string, boolean>>({})
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [inline, setInline] = useState<NotebookInlineEdit | null>(null)
  const [clipboard, setClipboard] = useState<NotebookClipboard | null>(null)
  const [dropOver, setDropOver] = useState('')
  const [versionBusy, setVersionBusy] = useState(false)
  const [versionModalDir, setVersionModalDir] = useState('')
  const [versionFlags, setVersionFlags] = useState<Record<string, boolean>>({})
  const inlineRef = useRef<HTMLInputElement>(null)

  const scopeRoots = useMemo(() => {
    if (scopeRootIds?.length) return scopeRootIds.filter(Boolean)
    if (scopeRootId) return [scopeRootId]
    return [] as string[]
  }, [scopeRootId, scopeRootIds])

  /** 空白处新建/粘贴落点：多根时优先运维，否则第一个根。 */
  const treeRootId = useMemo(() => {
    if (!scopeRoots.length) return NOTEBOOK_ROOT_ID
    if (scopeRoots.includes(NOTEBOOK_ROOT_OPS)) return NOTEBOOK_ROOT_OPS
    return scopeRoots[0]
  }, [scopeRoots])

  const isProtectedDir = useCallback(
    (id: string) => isSystemNotebookRoot(id) || scopeRoots.includes(id),
    [scopeRoots],
  )

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const tagLabels = useMemo(
    () => ({
      workflow: t('notebook.tagWorkflow'),
      memory: t('notebook.roleBadgeMemory'),
      versioned: t('notebook.tagVersioned'),
      localBound: t('notebook.tagLocalBound'),
      titleWorkflow: t('notebook.tagTitleWorkflow'),
      titleMemory: t('notebook.tagTitleMemory'),
      titleVersioned: t('notebook.tagTitleVersioned'),
      titleWorkflowFolder: t('notebook.tagTitleWorkflowFolder'),
      titleLocalBound: t('notebook.tagTitleLocalBound'),
    }),
    [t],
  )

  const { setProjectLocalDir, setProjectRemoteDir } = useHostProjectBinding({
    projectByDir,
    onProjectBindingChanged,
    t,
  })

  const roleSummaries = useMemo(() => {
    if (!roleFilter) return summaries
    return summaries.filter((n) => {
      const role = n.role || 'note'
      return role === roleFilter
    })
  }, [summaries, roleFilter])
  const fullTree = useMemo(() => buildNotebookTree(groups, roleSummaries), [groups, roleSummaries])
  const scopedTree = useMemo(() => {
    if (!scopeRoots.length) return fullTree
    const out: NotebookTreeNode[] = []
    for (const id of scopeRoots) {
      const sub = findNotebookSubtree(fullTree, id)
      if (sub) out.push(sub)
    }
    return out
  }, [fullTree, scopeRoots])
  const tree = useMemo(() => filterNotebookTree(scopedTree, search), [scopedTree, search])
  const filterActive = search.trim().length > 0 || Boolean(roleFilter)

  const refreshVersionFlags = useCallback(async () => {
    const ids = groups.map((g) => g.id).filter(Boolean)
    if (!ids.length) {
      setVersionFlags({})
      return
    }
    try {
      const flags = await api.mapDirVersionFlags(ids)
      setVersionFlags(flags)
    } catch {
      /* 标签为增强信息，失败不打断侧栏 */
    }
  }, [groups])

  useEffect(() => {
    void refreshVersionFlags()
  }, [refreshVersionFlags])

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
    if (selectedFolderId && !groupById.has(selectedFolderId)) onSelectFolder('')
  }, [selectedFolderId, groupById, onSelectFolder])

  useEffect(() => {
    if (!selectedFolderId) return
    setExpanded((m) => (m[selectedFolderId] ? m : { ...m, [selectedFolderId]: true }))
  }, [selectedFolderId])

  // 仅在进入重命名/新建会话时全选；勿依赖整份 inline（value 每键会变，否则下一字符会盖掉全选）。
  const inlineSessionKey =
    inline == null
      ? ''
      : inline.kind === 'rename'
        ? `rename:${inline.rel}`
        : `create:${inline.parent}:${inline.isDir ? 'd' : 'f'}`

  useEffect(() => {
    if (!inlineSessionKey) return
    const timer = window.setTimeout(() => {
      inlineRef.current?.focus()
      inlineRef.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [inlineSessionKey])

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
      notify.warning(t('notebook.batchNone'))
      return
    }
    setDeleting(true)
    try {
      await onBatchDelete(ids)
      notify.success(t('notebook.batchDeleted', { count: ids.length }))
      setSelectedNotes({})
    } catch (e) {
      notify.error((e as Error).message)
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
      .map((n) => basenameRel(n.id) || n.title)
    return [...kids, ...notes]
  }

  const beginRename = (rel: string) => {
    setCtx(null)
    setInline({ kind: 'rename', rel, value: basenameRel(rel) })
  }

  const createFolderVersion = async (dir: string) => {
    setCtx(null)
    setVersionBusy(true)
    try {
      const res = await api.pinDirVersion(dir, t('notebook.dirVersionCreateMessage'))
      const short = (res.version?.short || res.version?.hash?.slice(0, 7) || '').trim()
      const name = basenameRel(dir) || dir
      notify.success(
        short
          ? t('notebook.dirVersionCreatedShort', { short, name })
          : t('notebook.dirVersionCreated', { dir: name }),
        { detail: short || undefined },
      )
      setVersionFlags((m) => ({ ...m, [dir]: true }))
      void refreshVersionFlags()
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setVersionBusy(false)
    }
  }

  const openVersionHistory = (dir: string) => {
    setCtx(null)
    setVersionModalDir(dir)
  }

  const onTagActivate = (tag: ResourceTag) => {
    const kind = tag.action?.kind || ''
    const payload = tag.action?.payload || {}
    if (kind === TAG_OPEN_VERSION_HISTORY) {
      const dirRel = String(payload.dirRel || '').trim()
      if (dirRel) openVersionHistory(dirRel)
      return
    }
    if (kind === TAG_FOCUS_WORKFLOW) {
      const noteId = String(payload.noteId || '').trim()
      const dirRel = String(payload.dirRel || '').trim()
      if (dirRel) {
        onSelectFolder(dirRel)
        setExpanded((m) => ({ ...m, [dirRel]: true }))
      }
      if (noteId) onOpenNote(noteId)
      return
    }
    if (kind === TAG_OPEN_MEMORY_NOTE) {
      const noteId = String(payload.noteId || '').trim()
      if (noteId) onOpenNote(noteId)
    }
  }

  const cancelInline = () => setInline(null)

  const commitInline = async () => {
    if (!inline) return
    const name = inline.value.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      notify.warning(t('notebook.invalidName'))
      return
    }
    try {
      if (inline.kind === 'rename') {
        if (name === basenameRel(inline.rel)) {
          setInline(null)
          return
        }
        await onRenamePath(inline.rel, name)
        notify.success(t('notebook.renamedPath', { name }))
      } else if (inline.isDir) {
        await onCreateDirInline(inline.parent, name)
        setExpanded((m) => ({ ...m, [inline.parent]: true, [joinRel(inline.parent, name)]: true }))
        notify.success(t('notebook.createdGroup', { name }))
      } else {
        await onCreateFileInline(inline.parent, name)
        notify.success(t('notebook.created'))
      }
      setInline(null)
    } catch (e) {
      notify.error((e as Error).message)
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
    return treeRootId
  }

  useEffect(() => {
    if (!scopeRoots.length) return
    setExpanded((m) => {
      const next = { ...m }
      let changed = false
      for (const id of scopeRoots) {
        if (!next[id]) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : m
    })
  }, [scopeRoots])

  const cutRels = (rels: string[]) => {
    setCtx(null)
    if (!rels.length) return
    setClipboard({ mode: 'cut', rels })
    notify.info(t('notebook.cutItems', { count: rels.length }))
  }

  const copyRels = (rels: string[]) => {
    setCtx(null)
    if (!rels.length) return
    setClipboard({ mode: 'copy', rels })
    notify.info(t('notebook.copiedItems', { count: rels.length }))
  }

  const pasteClipboard = async (dest?: string) => {
    setCtx(null)
    if (!clipboard?.rels.length) {
      notify.warning(t('notebook.clipboardEmpty'))
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
      notify.success(t('notebook.pastedItems'))
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const onDragStart = (rel: string, e: DragEvent) => {
    e.dataTransfer.setData('text/wwb-notebook-rel', rel)
    e.dataTransfer.effectAllowed = 'move'
  }

  /** onDragStartNote 树内移动 + 统一资产 MIME 拖入 AI 侧栏。 */
  const onDragStartNote = (note: NoteSummary, e: DragEvent) => {
    const opRel = opRelForNote(note.id)
    const title = basenameRel(note.id) || note.title
    e.dataTransfer.setData('text/wwb-notebook-rel', opRel)
    e.dataTransfer.setData(
      NOTEBOOK_DRAG_MIME,
      JSON.stringify({ kind: 'note', id: note.id, title }),
    )
    beginAssetDrag(e, mentionNote({ id: note.id, title }), { effectAllowed: 'copyMove' })
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
      notify.success(t('notebook.movedPath'))
    } catch (err) {
      notify.error((err as Error).message)
    }
  }

  return (
    <section className={`sidebar-section notebook-list-section${compact ? ' is-compact' : ''}`}>
      {!compact ? (
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
              {...pressProps(() => beginInlineCreate(selectedFolderId || treeRootId, false))}
            >
              <IconPlus size={14} />
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-icon wn-btn-sm"
              title={t('notebook.newGroup')}
              {...pressProps(() => beginInlineCreate(selectedFolderId || treeRootId, true))}
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
      ) : (
        <div className="sidebar-header notebook-explorer-header is-compact">
          <div className="sidebar-header-actions">
            <button
              type="button"
              className="wn-btn wn-btn-icon wn-btn-sm"
              title={t('notebook.newFile')}
              {...pressProps(() => beginInlineCreate(selectedFolderId || treeRootId, false))}
            >
              <IconPlus size={14} />
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-icon wn-btn-sm"
              title={t('notebook.newGroup')}
              {...pressProps(() => beginInlineCreate(selectedFolderId || treeRootId, true))}
            >
              <IconFolder size={14} />
            </button>
          </div>
        </div>
      )}

      {!compact ? (
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
      ) : null}

      {selectionCount > 0 && (
        <div className="notebook-selection-bar">
          <span className="pane-meta">{t('notebook.selectedCount', { count: selectionCount })}</span>
          <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" {...pressProps(clearSelection)}>
            {t('notebook.batchClear')}
          </button>
          {onComposeBrief ? (
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-primary"
              {...pressProps(() => {
                const ids = Object.keys(selectedNotes).filter((id) => selectedNotes[id])
                if (ids.length === 0) {
                  notify.warning(t('notebook.briefNeedSources'))
                  return
                }
                onComposeBrief(ids)
                clearSelection()
              })}
            >
              {t('notebook.briefCompose')}
            </button>
          ) : null}
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
          onSelectFolder(treeRootId)
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.notebook-tree-folder, .notebook-tree-note')) return
          e.preventDefault()
          onSelectFolder(treeRootId)
          setCtx({ kind: 'root', x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDropOver(treeRootId)
        }}
        onDrop={(e) => void onDropFolder(treeRootId, e)}
      >
        <NotebookSidebarTree
          tree={tree}
          treeRootId={treeRootId}
          expanded={expanded}
          setExpanded={setExpanded}
          selectedFolderId={selectedFolderId}
          activeTabId={activeTabId}
          selectedNotes={selectedNotes}
          dropOver={dropOver}
          setDropOver={setDropOver}
          inline={inline}
          setInline={setInline}
          inlineRef={inlineRef}
          groupById={groupById}
          versionFlags={versionFlags}
          projectByDir={projectByDir}
          tagLabels={tagLabels}
          isProtectedDir={isProtectedDir}
          onSelectFolder={onSelectFolder}
          onOpenNote={onOpenNote}
          setCtx={setCtx}
          toggleNoteSelected={toggleNoteSelected}
          onDragStart={onDragStart}
          onDragStartNote={onDragStartNote}
          onDragOverFolder={onDragOverFolder}
          onDropFolder={onDropFolder}
          commitInline={commitInline}
          onInlineKey={onInlineKey}
          onTagActivate={onTagActivate}
          emptyHint={search.trim() ? t('notebook.noMatch') : t('notebook.noNotes')}
          t={t}
        />
      </div>

      {ctx && (
        <NotebookSidebarContextMenu
          ctx={ctx}
          onDismiss={() => setCtx(null)}
          treeRootId={treeRootId}
          scopeRootsLength={scopeRoots.length}
          clipboard={clipboard}
          versionBusy={versionBusy}
          isProtectedDir={isProtectedDir}
          beginInlineCreate={beginInlineCreate}
          beginRename={beginRename}
          pasteClipboard={pasteClipboard}
          cutRels={cutRels}
          copyRels={copyRels}
          createFolderVersion={createFolderVersion}
          openVersionHistory={openVersionHistory}
          setProjectLocalDir={setProjectLocalDir}
          setProjectRemoteDir={setProjectRemoteDir}
          onRevealPath={onRevealPath}
          onOpenNote={onOpenNote}
          onDeleteGroup={onDeleteGroup}
          onDeleteNote={onDeleteNote}
          onMakeNoteRole={onMakeNoteRole}
          t={t}
        />
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

      <DirVersionModal
        open={Boolean(versionModalDir)}
        dirRel={versionModalDir}
        onClose={() => setVersionModalDir('')}
        onRestored={() => {
          void onRefresh()
          void refreshVersionFlags()
        }}
      />
    </section>
  )
}

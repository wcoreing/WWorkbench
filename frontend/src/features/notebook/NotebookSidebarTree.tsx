import type {
  Dispatch,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  Ref,
  SetStateAction,
} from 'react'
import type { HostProject, NoteSummary, NotebookGroup } from '../../api/types'
import { IconFolder, IconNotebook } from '../../components/Icons'
import { ResourceTags, type ResourceTag } from '../../tags'
import {
  basenameRel,
  joinRel,
  opRelForNote,
  type NotebookInlineEdit,
} from './notebookPathOps'
import { resolveFolderResourceTags, resolveNoteResourceTags } from './notebookResourceTags'
import type { NotebookTreeNode } from './notebookTree'

type TFn = (key: string, params?: Record<string, string | number>) => string

type TagLabels = {
  workflow: string
  memory: string
  versioned: string
  localBound: string
  titleWorkflow: string
  titleMemory: string
  titleVersioned: string
  titleWorkflowFolder: string
  titleLocalBound: string
}

export type NotebookSidebarCtxSetter =
  | { kind: 'folder'; x: number; y: number; group: NotebookGroup }
  | { kind: 'note'; x: number; y: number; note: NoteSummary }
  | { kind: 'root'; x: number; y: number }

/** 笔记本侧栏文件树：文件夹/笔记行、行内重命名与新建。 */
export function NotebookSidebarTree(props: {
  tree: NotebookTreeNode[]
  treeRootId: string
  depth?: number
  parentId?: string
  expanded: Record<string, boolean>
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>
  selectedFolderId: string
  activeTabId: string | null
  selectedNotes: Record<string, boolean>
  dropOver: string
  setDropOver: Dispatch<SetStateAction<string>>
  inline: NotebookInlineEdit | null
  setInline: Dispatch<SetStateAction<NotebookInlineEdit | null>>
  inlineRef: Ref<HTMLInputElement>
  groupById: Map<string, NotebookGroup>
  versionFlags: Record<string, boolean>
  projectByDir: Record<string, HostProject>
  tagLabels: TagLabels
  isProtectedDir: (id: string) => boolean
  onSelectFolder: (folderId: string) => void
  onOpenNote: (id: string) => void
  setCtx: Dispatch<SetStateAction<NotebookSidebarCtxSetter | null>>
  toggleNoteSelected: (noteId: string, e: MouseEvent) => void
  onDragStart: (rel: string, e: DragEvent) => void
  onDragStartNote: (note: NoteSummary, e: DragEvent) => void
  onDragOverFolder: (folderId: string, e: DragEvent) => void
  onDropFolder: (folderId: string, e: DragEvent) => void
  commitInline: () => Promise<void>
  onInlineKey: (e: KeyboardEvent<HTMLInputElement>) => void
  onTagActivate: (tag: ResourceTag) => void
  emptyHint: string
  t: TFn
}) {
  const {
    tree,
    treeRootId,
    depth = 0,
    parentId = treeRootId,
    expanded,
    setExpanded,
    selectedFolderId,
    activeTabId,
    selectedNotes,
    dropOver,
    setDropOver,
    inline,
    setInline,
    inlineRef,
    groupById,
    versionFlags,
    projectByDir,
    tagLabels,
    isProtectedDir,
    onSelectFolder,
    onOpenNote,
    setCtx,
    toggleNoteSelected,
    onDragStart,
    onDragStartNote,
    onDragOverFolder,
    onDropFolder,
    commitInline,
    onInlineKey,
    onTagActivate,
    emptyHint,
    t,
  } = props

  const toggleExpand = (id: string) => {
    setExpanded((m) => ({ ...m, [id]: !m[id] }))
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
        onChange={(e) => {
          const value = e.target.value
          setInline((prev) => (prev ? { ...prev, value } : prev))
        }}
        onBlur={() => void commitInline()}
        onKeyDown={onInlineKey}
        onClick={(e) => e.stopPropagation()}
      />
    )
  }

  const renderCreateRow = (parent: string, rowDepth: number) => {
    if (!inline || inline.kind !== 'create' || inline.parent !== parent) return null
    return (
      <li key={`create-${parent}`}>
        <div className="notebook-tree-note is-inline" style={{ paddingLeft: 8 + rowDepth * 14 }}>
          <span className="notebook-tree-chevron" aria-hidden />
          <span className="notebook-tree-note-icon" aria-hidden>
            {inline.isDir ? <IconFolder size={14} /> : <IconNotebook size={14} />}
          </span>
          <input
            ref={inlineRef}
            className="notebook-tree-inline"
            value={inline.value}
            onChange={(e) => {
              const value = e.target.value
              setInline((prev) => (prev ? { ...prev, value } : prev))
            }}
            onBlur={() => void commitInline()}
            onKeyDown={onInlineKey}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </li>
    )
  }

  const renderNodes = (nodes: NotebookTreeNode[], rowDepth: number, parent: string) => (
    <ul className="notebook-tree">
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          const open = expanded[n.id] ?? rowDepth < 1
          const group = groupById.get(n.id)
          const renaming = inline?.kind === 'rename' && inline.rel === n.id
          return (
            <li key={`f-${n.id}`}>
              <div
                className={`notebook-tree-folder${selectedFolderId === n.id ? ' is-selected' : ''}${
                  dropOver === n.id ? ' is-drop-over' : ''
                }`}
                style={{ paddingLeft: 8 + rowDepth * 14 }}
                draggable={!isProtectedDir(n.id)}
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
                {renaming ? renderInline(n.id) : <span className="notebook-tree-label">{n.name}</span>}
                <ResourceTags
                  tags={resolveFolderResourceTags(
                    n.id,
                    Boolean(versionFlags[n.id]),
                    tagLabels,
                    projectByDir[n.id],
                  )}
                  onActivate={onTagActivate}
                />
              </div>
              {open ? (
                <>
                  {renderNodes(n.children, rowDepth + 1, n.id)}
                  {renderCreateRow(n.id, rowDepth + 1)}
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
              style={{ paddingLeft: 8 + rowDepth * 14 }}
              draggable
              onDragStart={(e) => onDragStartNote(note, e)}
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
              {renaming ? (
                renderInline(opRel)
              ) : (
                <span className="notebook-tree-label" title={basenameRel(note.id) || note.title}>
                  {basenameRel(note.id) || note.title}
                </span>
              )}
              <ResourceTags tags={resolveNoteResourceTags(note, tagLabels)} onActivate={onTagActivate} />
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
      {rowDepth === 0 ? renderCreateRow(parent, rowDepth) : null}
    </ul>
  )

  if (tree.length === 0 && !(inline && inline.kind === 'create' && inline.parent === treeRootId)) {
    return <div className="empty-hint">{emptyHint}</div>
  }
  return renderNodes(tree, depth, parentId)
}

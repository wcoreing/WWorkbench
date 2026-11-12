import { useEffect, useMemo, useState } from 'react'
import type { NoteSummary, NotebookGroup } from '../../api/types'
import { IconFolder, IconNotebook } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { basenameRel } from './notebookPathOps'
import {
  buildNotebookTree,
  findNotebookSubtree,
  type NotebookTreeNode,
} from './notebookTree'

interface Props {
  /** 只展示该目录及其子孙（如 工作流/小红书发布）。 */
  rootId: string
  groups: NotebookGroup[]
  summaries: NoteSummary[]
  activeNoteId?: string | null
  emptyHint?: string
  onOpenNote: (id: string) => void
}

/** NotebookScopedTree 复用笔记本文件树样式，限定到单个目录（Skill）。 */
export function NotebookScopedTree({
  rootId,
  groups,
  summaries,
  activeNoteId,
  emptyHint,
  onOpenNote,
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const fullTree = useMemo(() => buildNotebookTree(groups, summaries), [groups, summaries])
  const scoped = useMemo(() => {
    const sub = findNotebookSubtree(fullTree, rootId)
    return sub ? [sub] : []
  }, [fullTree, rootId])

  useEffect(() => {
    if (!rootId) return
    const open: Record<string, boolean> = { [rootId]: true }
    const walk = (nodes: NotebookTreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'folder') {
          open[n.id] = true
          walk(n.children)
        }
      }
    }
    walk(scoped)
    setExpanded((m) => ({ ...m, ...open }))
  }, [rootId, scoped])

  const toggle = (id: string) => {
    setExpanded((m) => ({ ...m, [id]: !m[id] }))
  }

  const renderNodes = (nodes: NotebookTreeNode[], depth: number) => (
    <ul className="notebook-tree">
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          const open = expanded[n.id] ?? true
          return (
            <li key={`f-${n.id}`}>
              <div
                className="notebook-tree-folder"
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => toggle(n.id)}
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
        const fileName = basenameRel(note.id) || note.title
        return (
          <li key={`n-${note.id}`}>
            <div
              className={`notebook-tree-note${activeNoteId === note.id ? ' is-active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onOpenNote(note.id)}
              title={fileName}
            >
              <span className="notebook-tree-chevron" aria-hidden />
              <span className="notebook-tree-note-icon" aria-hidden>
                <IconNotebook size={14} />
              </span>
              <span className="notebook-tree-label">{fileName}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )

  if (!rootId) {
    return <div className="empty-hint">{emptyHint || t('notebook.noNotes')}</div>
  }
  if (scoped.length === 0) {
    return <div className="empty-hint">{emptyHint || t('notebook.noNotes')}</div>
  }

  return <div className="notebook-tree-body notebook-scoped-tree">{renderNodes(scoped, 0)}</div>
}

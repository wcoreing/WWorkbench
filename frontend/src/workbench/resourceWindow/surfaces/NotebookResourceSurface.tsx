import { useMemo } from 'react'
import { NotebookIDE } from '../../../features/notebook/NotebookIDE'
import { dirRelFromNoteId, dirRelFromScope } from '../../../features/notebook/noteModel'
import { skillDirFromNoteId } from '../../../features/notebook/notebookTree'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

function resolveScope(win: ResourceWindow): { scopeRootId: string; preferredNoteId?: string } {
  const id = win.resourceId.replace(/\\/g, '/').replace(/\/+$/, '')
  if (win.kind === 'skill') {
    const dir = skillDirFromNoteId(id) || dirRelFromScope(id) || id
    return {
      scopeRootId: dir,
      preferredNoteId: /\/SKILL\.md$/i.test(id) ? id : `${dir}/SKILL.md`,
    }
  }
  if (/\.md$/i.test(id)) {
    const parent = dirRelFromNoteId(id)
    return { scopeRootId: parent || id, preferredNoteId: id }
  }
  return { scopeRootId: id }
}

/** NotebookResourceSurface 嵌入式笔记/Skill（复用 NotebookIDE）。 */
export function NotebookResourceSurface({ window: win }: Props) {
  // 依赖 primitive，避免父级 upsert 换对象引用导致 IDE 反复 reset
  const { scopeRootId, preferredNoteId } = useMemo(
    () => resolveScope(win),
    [win.kind, win.resourceId, win.title],
  )

  return (
    <div className="rw-surface rw-surface-notebook">
      <NotebookIDE
        scopeRootId={scopeRootId}
        title={win.title}
        preferredNoteId={preferredNoteId}
        autoOpenEntry
        hideTree={false}
        treeWidth={160}
        className="rw-notebook-ide"
      />
    </div>
  )
}

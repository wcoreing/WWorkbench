import type { NotebookGroup } from '../../api/types'
import { NOTEBOOK_ROOT_ID } from './notebookTree'

/** breadcrumbLabels 从分组链拼出 IDE 面包屑（根 → … → 当前目录）。 */
export function breadcrumbLabels(
  groups: NotebookGroup[],
  groupId: string,
  rootLabel: string,
): string[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const parts: string[] = []
  let cur = (groupId || '').trim()
  const guard = new Set<string>()
  while (cur && cur !== NOTEBOOK_ROOT_ID && !guard.has(cur)) {
    guard.add(cur)
    const g = byId.get(cur)
    if (!g) break
    parts.unshift(g.name)
    cur = (g.parentId || '').trim()
  }
  return [rootLabel, ...parts]
}

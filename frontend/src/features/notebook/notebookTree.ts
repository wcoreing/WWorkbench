import type { NoteSummary, NotebookGroup } from '../../api/types'

export const NOTEBOOK_DRAG_MIME = 'application/x-wworkbench-notebook'

/** NOTEBOOK_ROOT_ID 根目录（未分组）笔记的 groupId。 */
export const NOTEBOOK_ROOT_ID = ''

export type NotebookDragPayload = { kind: 'note' | 'group'; id: string }

/** parseNotebookDrag 解析侧栏拖拽载荷。 */
export function parseNotebookDrag(raw: string): NotebookDragPayload | null {
  try {
    const o = JSON.parse(raw) as NotebookDragPayload
    if ((o.kind === 'note' || o.kind === 'group') && o.id) return o
  } catch {
    /* ignore */
  }
  return null
}

/** orderedGroups 按 sortOrder 排序分组。 */
export function orderedGroups(groups: NotebookGroup[]): NotebookGroup[] {
  return [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/** notesInGroup 取某分组内已排序的笔记摘要。 */
export function notesInGroup(summaries: NoteSummary[], groupId: string): NoteSummary[] {
  return summaries
    .filter((n) => n.groupId === groupId)
    .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
}

/** buildNotebookLayout 构建可持久化的侧栏布局（含根目录）。 */
export function buildNotebookLayout(groups: NotebookGroup[], summaries: NoteSummary[]) {
  const ogs = orderedGroups(groups)
  const notesByGroup: Record<string, string[]> = {
    [NOTEBOOK_ROOT_ID]: notesInGroup(summaries, NOTEBOOK_ROOT_ID).map((n) => n.id),
  }
  for (const g of ogs) {
    notesByGroup[g.id] = notesInGroup(summaries, g.id).map((n) => n.id)
  }
  return { groupOrder: ogs.map((g) => g.id), notesByGroup }
}

/** nextNoteSortOrder 分组内下一个 sortOrder。 */
export function nextNoteSortOrder(summaries: NoteSummary[], groupId: string): number {
  const list = notesInGroup(summaries, groupId)
  if (list.length === 0) return 0
  return Math.max(...list.map((n) => n.sortOrder)) + 1
}

/** moveGroupBefore 调整分组顺序（拖到目标分组前）。 */
export function moveGroupBefore(
  groups: NotebookGroup[],
  dragGroupId: string,
  beforeGroupId: string,
): NotebookGroup[] {
  if (dragGroupId === beforeGroupId) return groups
  const order = orderedGroups(groups).map((g) => g.id)
  const from = order.indexOf(dragGroupId)
  const to = order.indexOf(beforeGroupId)
  if (from < 0 || to < 0) return groups
  order.splice(from, 1)
  order.splice(to, 0, dragGroupId)
  return order.map((id, i) => {
    const g = groups.find((x) => x.id === id)!
    return { ...g, sortOrder: i }
  })
}

/** normalizeNoteSortOrders 按分组重排 sortOrder（0..n-1）。 */
export function normalizeNoteSortOrders(summaries: NoteSummary[]): NoteSummary[] {
  const byGroup = new Map<string, NoteSummary[]>()
  for (const n of summaries) {
    const list = byGroup.get(n.groupId) ?? []
    list.push(n)
    byGroup.set(n.groupId, list)
  }
  const out: NoteSummary[] = []
  for (const list of byGroup.values()) {
    const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
    sorted.forEach((n, i) => out.push({ ...n, sortOrder: i }))
  }
  return out
}

/** moveNoteInTree 移动笔记到目标分组及插入位置。 */
export function moveNoteInTree(
  summaries: NoteSummary[],
  noteId: string,
  targetGroupId: string,
  beforeNoteId?: string | null,
): NoteSummary[] {
  const note = summaries.find((n) => n.id === noteId)
  if (!note) return summaries
  const rest = summaries.filter((n) => n.id !== noteId)
  const moved: NoteSummary = { ...note, groupId: targetGroupId }
  const bucket = notesInGroup(rest, targetGroupId)
  let insertAt = bucket.length
  if (beforeNoteId) {
    const idx = bucket.findIndex((n) => n.id === beforeNoteId)
    if (idx >= 0) insertAt = idx
  }
  bucket.splice(insertAt, 0, moved)
  const others = rest.filter((n) => n.groupId !== targetGroupId)
  return normalizeNoteSortOrders([...others, ...bucket])
}

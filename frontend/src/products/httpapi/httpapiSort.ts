import type { HTTPFolder, HTTPSavedRequest } from '../../api/types'
import { buildHttpApiTree, type HttpTreeNode } from './httpapiTree'

export type HttpLayoutEntryKey = `folder:${string}` | `api:${string}`

export type HttpDragPayload = { kind: 'folder' | 'api'; id: string }

export type HttpDropTarget =
  | { mode: 'into'; parentId: string }
  | { mode: 'before'; parentId: string; beforeKey: HttpLayoutEntryKey | '__end__' }

/** entryKey 生成布局项键。 */
export function entryKey(kind: 'folder' | 'api', id: string): HttpLayoutEntryKey {
  return `${kind}:${id}` as HttpLayoutEntryKey
}

/** parseEntryKey 解析布局项键。 */
export function parseEntryKey(key: string): HttpDragPayload | null {
  const i = key.indexOf(':')
  if (i <= 0) return null
  const kind = key.slice(0, i)
  const id = key.slice(i + 1)
  if ((kind === 'folder' || kind === 'api') && id) return { kind, id }
  return null
}

/** siblingsInParent 取同级目录与接口（已排序）。 */
export function siblingsInParent(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  parentId: string,
): HttpLayoutEntryKey[] {
  const pid = parentId || ''
  const fs = folders
    .filter((f) => (f.parentId || '') === pid)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const apis = items
    .filter((i) => (i.folderId || '') === pid)
    .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt)
  const merged: { key: HttpLayoutEntryKey; order: number }[] = [
    ...fs.map((f) => ({ key: entryKey('folder', f.id), order: f.sortOrder })),
    ...apis.map((a) => ({ key: entryKey('api', a.id), order: a.sortOrder })),
  ]
  merged.sort((a, b) => a.order - b.order)
  return merged.map((m) => m.key)
}

/** buildHttpApiTreeLayout 从当前数据构建完整侧栏布局。 */
export function buildHttpApiTreeLayout(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
): Record<string, string[]> {
  const parentIds = new Set<string>([''])
  for (const f of folders) parentIds.add(f.id)
  const out: Record<string, string[]> = {}
  for (const pid of parentIds) {
    const list = siblingsInParent(folders, items, pid)
    if (list.length) out[pid] = list
  }
  return out
}

/** nextHttpChildSortOrder 父级下下一个 sortOrder。 */
export function nextHttpChildSortOrder(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  parentId: string,
): number {
  const pid = parentId || ''
  let max = -1
  for (const f of folders) {
    if ((f.parentId || '') === pid) max = Math.max(max, f.sortOrder)
  }
  for (const i of items) {
    if ((i.folderId || '') === pid) max = Math.max(max, i.sortOrder)
  }
  return max + 1
}

/** isFolderDescendant 判断 target 是否为 folder 自身或其后代目录。 */
export function isFolderDescendant(folders: HTTPFolder[], folderId: string, targetId: string): boolean {
  if (!folderId || !targetId) return false
  if (folderId === targetId) return true
  const children = new Map<string, string[]>()
  for (const f of folders) {
    const pid = f.parentId || ''
    const list = children.get(pid) ?? []
    list.push(f.id)
    children.set(pid, list)
  }
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === targetId) return true
    if (seen.has(id)) return false
    seen.add(id)
    for (const cid of children.get(id) ?? []) {
      if (walk(cid)) return true
    }
    return false
  }
  return walk(folderId)
}

/** shouldSkipHttpTreeDrop 是否无需提交布局（同位置或非法）。 */
export function shouldSkipHttpTreeDrop(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  drag: HttpDragPayload,
  target: HttpDropTarget,
): boolean {
  if (drag.kind === 'folder' && target.mode === 'into' && isFolderDescendant(folders, drag.id, target.parentId)) {
    return true
  }
  if (drag.kind === 'folder' && target.mode === 'before' && isFolderDescendant(folders, drag.id, target.parentId)) {
    return true
  }
  const parentId = target.parentId || ''
  if (drag.kind === 'folder') {
    const f = folders.find((x) => x.id === drag.id)
    if (!f) return true
    if ((f.parentId || '') === parentId && target.mode === 'into') return true
  } else {
    const item = items.find((x) => x.id === drag.id)
    if (!item) return true
    if ((item.folderId || '') === parentId && target.mode === 'into') return true
  }
  return false
}

/** applyHttpTreeDrop 在内存中应用拖放并返回新布局。 */
export function applyHttpTreeDrop(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  drag: HttpDragPayload,
  target: HttpDropTarget,
): Record<string, string[]> | null {
  if (shouldSkipHttpTreeDrop(folders, items, drag, target)) return null

  const parentId = target.parentId || ''
  const dragKey = entryKey(drag.kind, drag.id)
  const layout = buildHttpApiTreeLayout(folders, items)
  const list = [...(layout[parentId] ?? [])].filter((k) => k !== dragKey)

  let insertAt = list.length
  if (target.mode === 'before') {
    if (target.beforeKey !== '__end__') {
      const idx = list.indexOf(target.beforeKey)
      insertAt = idx >= 0 ? idx : list.length
    }
  }

  list.splice(insertAt, 0, dragKey)

  const nextFolders = folders.map((f) => ({ ...f }))
  const nextItems = items.map((i) => ({ ...i }))

  if (drag.kind === 'folder') {
    const f = nextFolders.find((x) => x.id === drag.id)
    if (!f) return null
    f.parentId = parentId
  } else {
    const item = nextItems.find((x) => x.id === drag.id)
    if (!item) return null
    item.folderId = parentId
  }

  for (const pid of Object.keys(layout)) {
    layout[pid] = layout[pid].filter((k) => k !== dragKey)
  }
  layout[parentId] = list

  for (const [pid, keys] of Object.entries(layout)) {
    keys.forEach((key, sortOrder) => {
      const parsed = parseEntryKey(key)
      if (!parsed) return
      if (parsed.kind === 'folder') {
        const f = nextFolders.find((x) => x.id === parsed.id)
        if (f) {
          f.parentId = pid
          f.sortOrder = sortOrder
        }
      } else {
        const item = nextItems.find((x) => x.id === parsed.id)
        if (item) {
          item.folderId = pid
          item.sortOrder = sortOrder
        }
      }
    })
  }

  return buildHttpApiTreeLayout(nextFolders, nextItems)
}

/** nodeEntryKey 树节点对应的布局键。 */
export function nodeEntryKey(node: HttpTreeNode): HttpLayoutEntryKey {
  return node.kind === 'folder' ? entryKey('folder', node.id) : entryKey('api', node.item.id)
}

/** sortTreeChildren 对树子节点按 sortOrder 排序（buildHttpApiTree 之后调用）。 */
export function sortTreeChildren(
  nodes: HttpTreeNode[],
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
): HttpTreeNode[] {
  const orderOf = (n: HttpTreeNode): number => {
    if (n.kind === 'folder') {
      return folders.find((f) => f.id === n.id)?.sortOrder ?? 0
    }
    return n.item.sortOrder
  }
  return [...nodes]
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((n) =>
      n.kind === 'folder'
        ? { ...n, children: sortTreeChildren(n.children, folders, items) }
        : n,
    )
}

/** buildSortedHttpApiTree 构建并按 sortOrder 排序的目录树。 */
export function buildSortedHttpApiTree(folders: HTTPFolder[], items: HTTPSavedRequest[]): HttpTreeNode[] {
  return sortTreeChildren(buildHttpApiTree(folders, items), folders, items)
}

import type { HTTPFolder, HTTPSavedRequest } from '../../api/types'

export type HttpTreeNode =
  | { kind: 'folder'; id: string; name: string; parentId: string; children: HttpTreeNode[] }
  | { kind: 'api'; item: HTTPSavedRequest }

/** buildHttpApiTree 构建 Apifox 式目录树。 */
export function buildHttpApiTree(folders: HTTPFolder[], items: HTTPSavedRequest[]): HttpTreeNode[] {
  const folderNodes = new Map<string, HttpTreeNode & { kind: 'folder' }>()
  for (const f of folders) {
    folderNodes.set(f.id, { kind: 'folder', id: f.id, name: f.name, parentId: f.parentId, children: [] })
  }
  const roots: HttpTreeNode[] = []
  for (const f of folders) {
    const node = folderNodes.get(f.id)!
    const parent = f.parentId ? folderNodes.get(f.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  for (const item of items) {
    const api: HttpTreeNode = { kind: 'api', item }
    const parent = item.folderId ? folderNodes.get(item.folderId) : undefined
    if (parent) parent.children.push(api)
    else roots.push(api)
  }
  return roots
}

/** filterHttpTree 按关键词过滤树（保留匹配路径）。 */
export function filterHttpTree(nodes: HttpTreeNode[], q: string): HttpTreeNode[] {
  const query = q.trim().toLowerCase()
  if (!query) return nodes
  const walk = (list: HttpTreeNode[]): HttpTreeNode[] => {
    const out: HttpTreeNode[] = []
    for (const n of list) {
      if (n.kind === 'api') {
        const hit =
          n.item.name.toLowerCase().includes(query) ||
          n.item.url.toLowerCase().includes(query) ||
          (n.item.method || '').toLowerCase().includes(query)
        if (hit) out.push(n)
      } else {
        const children = walk(n.children)
        if (n.name.toLowerCase().includes(query) || children.length) {
          out.push({ ...n, children })
        }
      }
    }
    return out
  }
  return walk(nodes)
}

export type HttpTreeSubtree = { folderIds: string[]; apiIds: string[] }

/** collectHttpTreeSubtree 收集节点子树内全部目录与接口 id。 */
export function collectHttpTreeSubtree(node: HttpTreeNode): HttpTreeSubtree {
  if (node.kind === 'api') {
    return { folderIds: [], apiIds: [node.item.id] }
  }
  const folderIds = [node.id]
  const apiIds: string[] = []
  for (const c of node.children) {
    const sub = collectHttpTreeSubtree(c)
    folderIds.push(...sub.folderIds)
    apiIds.push(...sub.apiIds)
  }
  return { folderIds, apiIds }
}

/** collectHttpTreeAll 收集多棵子树的全部目录与接口 id。 */
export function collectHttpTreeAll(nodes: HttpTreeNode[]): HttpTreeSubtree {
  const folderIds: string[] = []
  const apiIds: string[] = []
  for (const n of nodes) {
    const sub = collectHttpTreeSubtree(n)
    folderIds.push(...sub.folderIds)
    apiIds.push(...sub.apiIds)
  }
  return { folderIds, apiIds }
}

/** expandFolderIdsWithDescendants 展开目录 id（含所有子目录）。 */
export function expandFolderIdsWithDescendants(folders: HTTPFolder[], rootIds: string[]): string[] {
  const children = new Map<string, string[]>()
  for (const f of folders) {
    const pid = f.parentId || ''
    const list = children.get(pid) ?? []
    list.push(f.id)
    children.set(pid, list)
  }
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
    for (const cid of children.get(id) ?? []) walk(cid)
  }
  for (const id of rootIds) walk(id)
  return out
}

/** resolveBatchDeletePlan 计算实际删除的目录与接口 id（目录含子树接口）。 */
export function resolveBatchDeletePlan(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  selectedFolders: Record<string, boolean>,
  selectedApis: Record<string, boolean>,
): { folderIds: string[]; apiIds: string[] } {
  const folderRoots = folders.filter((f) => selectedFolders[f.id]).map((f) => f.id)
  const folderIds = expandFolderIdsWithDescendants(folders, folderRoots)
  const folderSet = new Set(folderIds)
  const apiInFolders = items.filter((i) => i.folderId && folderSet.has(i.folderId)).map((i) => i.id)
  const apiExplicit = items.filter((i) => selectedApis[i.id] && !folderSet.has(i.folderId)).map((i) => i.id)
  const apiIds = [...new Set([...apiInFolders, ...apiExplicit])]
  return { folderIds, apiIds }
}

/** countBatchSelection 统计勾选数量（目录含子目录，接口去重）。 */
export function countBatchSelection(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  selectedFolders: Record<string, boolean>,
  selectedApis: Record<string, boolean>,
): { folders: number; apis: number; total: number } {
  const plan = resolveBatchDeletePlan(folders, items, selectedFolders, selectedApis)
  return { folders: plan.folderIds.length, apis: plan.apiIds.length, total: plan.folderIds.length + plan.apiIds.length }
}

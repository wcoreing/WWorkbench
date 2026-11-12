import type { ProductId } from '../../shell/products'

/** 笔记本根下业务工作根：产品只挂自己的根，彼此隔离。 */

export const NOTEBOOK_ROOT_WORKFLOW = '工作流'
export const NOTEBOOK_ROOT_OPS = '运维'
export const NOTEBOOK_ROOT_MEMORY = '记忆区'

/** 系统顶栏目录（不可删改名）。 */
export const SYSTEM_NOTEBOOK_ROOTS = [
  NOTEBOOK_ROOT_WORKFLOW,
  NOTEBOOK_ROOT_OPS,
  NOTEBOOK_ROOT_MEMORY,
] as const

export type SystemNotebookRoot = (typeof SYSTEM_NOTEBOOK_ROOTS)[number]

/**
 * 产品 → 笔记本工作根（可多个，侧栏并列显示）。
 * 空数组保留作「全盘」扩展位；运维壳 = 记忆区 + 运维，不露工作流。
 */
export const PRODUCT_NOTEBOOK_ROOTS: Record<ProductId, readonly string[]> = {
  browser: [NOTEBOOK_ROOT_WORKFLOW],
  terminal: [NOTEBOOK_ROOT_OPS],
  sftp: [NOTEBOOK_ROOT_OPS],
  docker: [NOTEBOOK_ROOT_OPS],
  environment: [NOTEBOOK_ROOT_OPS],
  backup: [NOTEBOOK_ROOT_OPS],
  database: [NOTEBOOK_ROOT_OPS],
  logs: [NOTEBOOK_ROOT_OPS],
  httpapi: [NOTEBOOK_ROOT_OPS],
  notebook: [NOTEBOOK_ROOT_MEMORY, NOTEBOOK_ROOT_OPS],
  plugins: [],
}

/** primaryNotebookRoot 产品主工作根（新建默认落点）；运维壳优先运维/。 */
export function primaryNotebookRoot(productId: ProductId): string {
  const roots = PRODUCT_NOTEBOOK_ROOTS[productId] || []
  if (roots.includes(NOTEBOOK_ROOT_OPS)) return NOTEBOOK_ROOT_OPS
  return roots[0] || ''
}

/** notebookRootsFor 产品挂载的全部工作根。 */
export function notebookRootsFor(productId: ProductId): readonly string[] {
  return PRODUCT_NOTEBOOK_ROOTS[productId] || []
}

/** isSystemNotebookRoot 是否系统业务根。 */
export function isSystemNotebookRoot(rel: string): boolean {
  const id = (rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return (SYSTEM_NOTEBOOK_ROOTS as readonly string[]).includes(id)
}

/** isMemoryProjectDir 是否 记忆区/{主机}/项目/{名}（本地/远端目录绑定落点）。 */
export function isMemoryProjectDir(rel: string): boolean {
  const id = (rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parts = id.split('/').filter(Boolean)
  return (
    parts.length === 4 &&
    parts[0] === NOTEBOOK_ROOT_MEMORY &&
    parts[2] === '项目' &&
    Boolean(parts[1] && parts[3])
  )
}

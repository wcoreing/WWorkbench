/** 产品线定义 — UI 壳按此注册各产品工作区 */

export type ProductId =
  | 'database'
  | 'terminal'
  | 'sftp'
  | 'docker'
  | 'environment'
  | 'notebook'
  | 'httpapi'
  | 'logs'
  | 'backup'
  | 'browser'
  | 'plugins'

export interface ProductDef {
  id: ProductId
  available: boolean
}

export const PRODUCTS: ProductDef[] = [
  { id: 'database', available: true },
  { id: 'terminal', available: true },
  { id: 'sftp', available: true },
  { id: 'docker', available: true },
  { id: 'environment', available: true },
  { id: 'notebook', available: true },
  { id: 'httpapi', available: true },
  { id: 'logs', available: true },
  { id: 'backup', available: true },
  { id: 'browser', available: true },
  { id: 'plugins', available: true },
]

/** normalizeProductId 旧版 skills 产品线并入笔记本。 */
export function normalizeProductId(id: string | null | undefined): ProductId {
  if (id === 'skills') return 'notebook'
  if (PRODUCTS.some((p) => p.id === id)) return id as ProductId
  return 'terminal'
}

/** getProduct 按 id 查找产品线元数据。 */
export function getProduct(id: ProductId): ProductDef {
  return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0]
}

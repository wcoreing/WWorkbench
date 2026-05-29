/** 产品线定义 — UI 壳按此注册各产品工作区 */

export type ProductId = 'database' | 'terminal' | 'sftp' | 'docker' | 'environment' | 'notebook'

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
]

/** getProduct 按 id 查找产品线元数据。 */
export function getProduct(id: ProductId): ProductDef {
  return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0]
}

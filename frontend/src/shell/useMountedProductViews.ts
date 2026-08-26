import { useEffect, useMemo, useState } from 'react'
import type { ProductId } from './products'

/** 同时挂载 DOM 的产品上限：当前 + 最近 1 个；其余卸载（JS chunk 仍由浏览器缓存）。 */
const MAX_MOUNTED_PRODUCTS = 5

/** 卸载时尽量保留：终端 xterm/会话重建成本高。 */
const PINNED_PRODUCTS = new Set<ProductId>(['terminal'])

function findEvictionIndex(order: ProductId[]): number {
  for (let i = order.length - 1; i >= 1; i--) {
    if (!PINNED_PRODUCTS.has(order[i])) return i
  }
  return order.length - 1
}

function trimMountOrder(order: ProductId[], max: number): ProductId[] {
  const keep = [...order]
  while (keep.length > max) {
    keep.splice(findEvictionIndex(keep), 1)
  }
  return keep
}

function touchMountOrder(order: ProductId[], active: ProductId): ProductId[] {
  return trimMountOrder([active, ...order.filter((k) => k !== active)], MAX_MOUNTED_PRODUCTS)
}

/** useMountedProductViews 已访问产品的 DOM 常驻 LRU（限数量，控制内存）。 */
export function useMountedProductViews(activeProduct: ProductId) {
  const [mountOrder, setMountOrder] = useState<ProductId[]>(() => [activeProduct])

  useEffect(() => {
    setMountOrder((prev) => touchMountOrder(prev, activeProduct))
  }, [activeProduct])

  const mountedProducts = useMemo(() => new Set(mountOrder), [mountOrder])

  return { mountedProducts, mountOrder }
}

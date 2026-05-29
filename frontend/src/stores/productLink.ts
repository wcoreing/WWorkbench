import { useCallback, useEffect, useRef } from 'react'
import type { ProductId } from '../shell/products'
import type { ProductLinkAction, ProductLinkRequest } from './appStore'
import { useAppStore } from './appStore'

/** productLinkToProduct 将跨产品动作映射到产品线 ID。 */
export function productLinkToProduct(action: ProductLinkAction): ProductId | null {
  switch (action) {
    case 'terminal':
      return 'terminal'
    case 'database':
      return 'database'
    case 'notebook':
      return 'notebook'
    case 'sftp':
      return 'sftp'
    case 'docker-context':
      return 'docker'
    default:
      return null
  }
}

let linkSeq = 0
const lastNonceByAction = new Map<ProductLinkAction, number>()

/** openProductLink 切换产品线并在目标工作台挂载后投递联动请求。 */
export function openProductLink(link: ProductLinkRequest) {
  const payload: ProductLinkRequest = { ...link, nonce: ++linkSeq }
  const target = productLinkToProduct(link.action)
  const { setActiveProduct, setProductLink } = useAppStore.getState()
  if (target) setActiveProduct(target)
  queueMicrotask(() => {
    requestAnimationFrame(() => setProductLink(payload))
  })
}

/** drainProductLink 取出并清空指定动作的联动请求（按 nonce 去重）。 */
export function drainProductLink(action: ProductLinkAction): ProductLinkRequest | null {
  const { productLink, setProductLink } = useAppStore.getState()
  if (!productLink || productLink.action !== action) return null
  const nonce = productLink.nonce ?? 0
  const last = lastNonceByAction.get(action) ?? 0
  if (nonce > 0 && nonce <= last) {
    setProductLink(null)
    return null
  }
  lastNonceByAction.set(action, nonce || ++linkSeq)
  setProductLink(null)
  return productLink
}

/** useProductLink 挂载时消费待处理联动，并订阅后续请求。 */
export function useProductLink(
  action: ProductLinkAction,
  onLink: (link: ProductLinkRequest) => void | Promise<void>
) {
  const handlerRef = useRef(onLink)
  handlerRef.current = onLink

  const consume = useCallback(() => {
    const link = drainProductLink(action)
    if (link) void handlerRef.current(link)
  }, [action])

  useEffect(() => {
    consume()
    return useAppStore.subscribe((state, prev) => {
      if (state.productLink?.action === action && state.productLink !== prev.productLink) {
        consume()
      }
    })
  }, [action, consume])
}

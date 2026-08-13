/** Wails WebView 中 window.confirm 不可靠，统一走应用内 ConfirmDialog。 */

export type ConfirmRequest = {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}

type Listener = () => void

let current: ConfirmRequest | null = null
let resolver: ((ok: boolean) => void) | null = null
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

/** subscribeConfirmDialog 供 ConfirmHost 订阅状态。 */
export function subscribeConfirmDialog(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** getConfirmDialogState 当前弹窗请求。 */
export function getConfirmDialogState(): ConfirmRequest | null {
  return current
}

/** askConfirm 弹出确认；确定 → true，取消/关闭 → false。 */
export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  if (resolver) {
    resolver(false)
    resolver = null
  }
  current = {
    title: req.title,
    message: req.message,
    confirmLabel: req.confirmLabel,
    danger: !!req.danger,
  }
  notify()
  return new Promise((resolve) => {
    resolver = resolve
  })
}

/** resolveConfirm 关闭弹窗并回传结果。 */
export function resolveConfirm(ok: boolean) {
  current = null
  const r = resolver
  resolver = null
  notify()
  r?.(ok)
}

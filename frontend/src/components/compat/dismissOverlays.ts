/** 全局收起浮层：切产品 / 关弹层时统一派发，避免隐藏页的 Select/菜单仍挡住点击。 */

export const DISMISS_OVERLAYS_EVENT = 'ww:dismiss-overlays'

/** dismissOverlays 通知所有浮层立即关闭。 */
export function dismissOverlays() {
  window.dispatchEvent(new Event(DISMISS_OVERLAYS_EVENT))
}

/** subscribeDismissOverlays 订阅全局收起。 */
export function subscribeDismissOverlays(onDismiss: () => void): () => void {
  window.addEventListener(DISMISS_OVERLAYS_EVENT, onDismiss)
  return () => window.removeEventListener(DISMISS_OVERLAYS_EVENT, onDismiss)
}

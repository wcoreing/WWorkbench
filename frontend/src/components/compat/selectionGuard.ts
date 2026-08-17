/** 小于此像素位移的拖拽视为点击，清掉误选区（壳层 zoom 下尤其容易飞选）。 */
export const SELECT_DRAG_SLOP_PX = 5

/**
 * bindSelectionGuard — 抑制误触选区：未形成有效拖拽则 clearSelection。
 * 用于 xterm / Monaco 等在 CSS zoom 下「稍一移动就大块选中」的场景。
 */
export function bindSelectionGuard(el: HTMLElement, clearSelection: () => void): () => void {
  let origin: { x: number; y: number } | null = null
  let dragged = false

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    origin = { x: e.clientX, y: e.clientY }
    dragged = false
  }
  const onMove = (e: MouseEvent) => {
    if (!origin || (e.buttons & 1) === 0) return
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > SELECT_DRAG_SLOP_PX) {
      dragged = true
    }
  }
  const onUp = () => {
    if (origin && !dragged) clearSelection()
    origin = null
    dragged = false
  }

  el.addEventListener('mousedown', onDown, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('mouseup', onUp, true)
  return () => {
    el.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('mouseup', onUp, true)
  }
}

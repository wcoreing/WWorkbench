import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

/** 记录 pointerdown 是否落在 backdrop 自身（跨 re-render 仍有效）。 */
const downOnBackdrop = new WeakMap<EventTarget, boolean>()

/**
 * 遮罩关闭：仅当 pointerdown 与 click 都落在 backdrop 本身时才关闭。
 *
 * 勿用 pressProps(onClose) / 裸 onClick={onClose} 绑遮罩——
 * 弹窗内拖选文字（尤其从右往左）时 mouseup 常落在遮罩，click 会误关。
 */
export function backdropDismissProps(onClose: () => void) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      downOnBackdrop.set(e.currentTarget, e.target === e.currentTarget)
    },
    onClick: (e: ReactMouseEvent) => {
      if (e.target !== e.currentTarget) return
      if (!downOnBackdrop.get(e.currentTarget)) return
      downOnBackdrop.set(e.currentTarget, false)
      onClose()
    },
  }
}

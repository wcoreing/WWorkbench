import type { MouseEvent as ReactMouseEvent } from 'react'

/**
 * bindPointerAction 绑定「按下即触发」的鼠标左键操作。
 * xterm / Monaco 等持焦时，click 常需点两次；pointerdown + preventDefault 可统一规避。
 */
export function bindPointerAction(handler: () => void) {
  return {
    onMouseDown: (e: ReactMouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      handler()
    },
  }
}

/** bindPointerActionWithEvent 同上，回调接收原始事件（用于 stopPropagation 等）。 */
export function bindPointerActionWithEvent(handler: (e: React.MouseEvent) => void) {
  return {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      handler(e)
    },
  }
}

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

export type PressHandler = (e: ReactPointerEvent | ReactKeyboardEvent) => void

/**
 * pressProps 对齐 agentdesk `v-press`：
 * 工具条 / 弹窗操作统一走 pointerdown.prevent，避免「先点内容再点按钮要两次」
 * （第一次 click 常被焦移吞掉）。键盘 Enter / Space 仍可用。
 */
export function pressProps(run: PressHandler | undefined, disabled = false) {
  if (!run) return {}
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      if (disabled) return
      e.preventDefault()
      run(e)
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (disabled) return
      e.preventDefault()
      run(e)
    },
  }
}

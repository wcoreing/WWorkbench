import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

export type PressHandler = (e: ReactPointerEvent | ReactKeyboardEvent) => void

export type PressOptions = {
  /** 禁用时不触发（对齐 button.disabled）。 */
  disabled?: boolean
  /** 等价 agentdesk `v-press.stop`。 */
  stop?: boolean
}

/**
 * pressProps — Compat 命令层：可点击控件统一走 pointerdown.prevent。
 *
 * 解决 Wails/WebView 下 xterm、Monaco 持焦时第一次 click 被焦移吞掉。
 * 可套在任意 UI 框架的 Button 上：`{...pressProps(onSave)}`。
 * 不适用：input / textarea / 原生 select / 需聚焦的 checkbox、拖拽手柄。
 */
export function pressProps(run: PressHandler | undefined, options: PressOptions = {}) {
  if (!run) return {}
  const { disabled = false, stop = false } = options
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      if (disabled) return
      e.preventDefault()
      if (stop) e.stopPropagation()
      run(e)
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      if (disabled) return
      e.preventDefault()
      if (stop) e.stopPropagation()
      run(e)
    },
  }
}

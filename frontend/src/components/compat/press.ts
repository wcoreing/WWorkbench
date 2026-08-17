import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'

export type PressHandler = (e: ReactPointerEvent | ReactKeyboardEvent | SyntheticEvent) => void

export type PressOptions = {
  /** 禁用时不触发（对齐 button.disabled）。 */
  disabled?: boolean
  /** 等价 agentdesk `v-press.stop`。 */
  stop?: boolean
}

/** 同一控件短时重复 press（FocusGate 延迟重派 pointerdown + click）只执行一次。 */
const recentPressAt = new WeakMap<object, number>()
const PRESS_DEDUP_MS = 200

function takePressSlot(target: object): boolean {
  const now = performance.now()
  const prev = recentPressAt.get(target)
  if (prev != null && now - prev < PRESS_DEDUP_MS) return false
  recentPressAt.set(target, now)
  return true
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
  const invoke = (e: ReactPointerEvent | ReactKeyboardEvent | SyntheticEvent) => {
    if (disabled) return
    if (!takePressSlot(e.currentTarget)) return
    if ('preventDefault' in e) e.preventDefault()
    if (stop) e.stopPropagation()
    run(e)
  }
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      invoke(e)
    },
    onClick: (e: SyntheticEvent) => {
      // FocusGate 重派 pointerdown 若未进 React，靠 click() 兜底
      invoke(e)
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      invoke(e)
    },
  }
}

import { useCallback, useRef, type UIEvent } from 'react'

/** scrollRatio 可见区域在可滚动范围中的位置，0 到 1。 */
export function scrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const max = scrollHeight - clientHeight
  if (max <= 1) return 0
  return Math.min(1, Math.max(0, scrollTop / max))
}

/** applyScrollRatio 按比例设置滚动位置。位置已对齐时返回 false。 */
export function applyScrollRatio(el: HTMLElement, ratio: number): boolean {
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const next = ratio * max
  if (Math.abs(el.scrollTop - next) < 1) return false
  el.scrollTop = next
  return true
}

/**
 * useMdSplitScroll 双屏时让编辑区与预览按同一比例滚动。
 * 回声标记避免一侧滚动再把另一侧推回来。
 */
export function useMdSplitScroll(active: boolean) {
  const previewRef = useRef<HTMLDivElement>(null)
  const applyEditor = useRef<((ratio: number) => boolean) | null>(null)
  const echo = useRef<'editor' | 'preview' | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  const bindEditorScroll = useCallback((fn: ((ratio: number) => boolean) | null) => {
    applyEditor.current = fn
  }, [])

  const onEditorRatio = useCallback((ratio: number) => {
    if (!activeRef.current) return
    if (echo.current === 'editor') {
      echo.current = null
      return
    }
    const el = previewRef.current
    if (!el) return
    if (!applyScrollRatio(el, ratio)) return
    echo.current = 'preview'
  }, [])

  const onPreviewScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!activeRef.current) return
    if (echo.current === 'preview') {
      echo.current = null
      return
    }
    const el = event.currentTarget
    const apply = applyEditor.current
    if (!apply) return
    const ratio = scrollRatio(el.scrollTop, el.scrollHeight, el.clientHeight)
    echo.current = 'editor'
    if (!apply(ratio)) echo.current = null
  }, [])

  return { previewRef, onEditorRatio, onPreviewScroll, bindEditorScroll }
}

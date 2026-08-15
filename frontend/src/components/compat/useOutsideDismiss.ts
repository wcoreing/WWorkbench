/**
 * useOutsideDismiss — 弹出层外点关闭且不吞点击（click-through）。
 *
 * 在 capture 阶段关闭，但不 preventDefault / stopPropagation，
 * 让同一次 pointerdown 仍能落到下方的「取消 / 导出」等命令按钮。
 * 原生 select 做不到这一点（系统层吃掉第一次外点）。
 */
import { useEffect, useRef, type RefObject } from 'react'

export function useOutsideDismiss(
  open: boolean,
  onDismiss: () => void,
  rootRefs: Array<RefObject<HTMLElement | null>>,
) {
  const rootsRef = useRef(rootRefs)
  rootsRef.current = rootRefs
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (rootsRef.current.some((r) => r.current?.contains(t))) return
      dismissRef.current()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
}

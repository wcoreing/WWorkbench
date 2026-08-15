import { useEffect, useRef, type RefObject } from 'react'

type OutsideClose = (e: PointerEvent) => void

/**
 * onPointerDownOutside — 弹出层/菜单的外点关闭。
 *
 * 必须用 pointerdown，不能用 click/mousedown：
 * Compat pressProps 会在 pointerdown 上 preventDefault，从而取消后续 mouse 事件，
 * 若仍监听 click 关闭，会出现「点产品轨/按钮要点两次」.
 */
export function onPointerDownOutside(
  isInside: (target: EventTarget | null) => boolean,
  close: () => void,
): OutsideClose {
  return (e: PointerEvent) => {
    if (e.button !== 0) return
    if (isInside(e.target)) return
    close()
  }
}

/** useDismissOnPointerDown 在 open 时监听外点 pointerdown 关闭。 */
export function useDismissOnPointerDown(
  open: boolean,
  close: () => void,
  rootRef?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return
    const onDown = onPointerDownOutside(
      (t) => !!(t && rootRef?.current?.contains(t as Node)),
      () => closeRef.current(),
    )
    // 冒泡阶段：先让目标上的 pressProps 执行，再关菜单
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open, rootRef])
}

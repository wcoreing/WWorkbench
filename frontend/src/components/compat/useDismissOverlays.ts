import { useEffect, useRef } from 'react'
import { subscribeDismissOverlays } from './dismissOverlays'

/** useDismissOverlays 在全局收起事件时执行回调（关菜单 / Select）。 */
export function useDismissOverlays(onDismiss: () => void) {
  const ref = useRef(onDismiss)
  ref.current = onDismiss
  useEffect(() => subscribeDismissOverlays(() => ref.current()), [])
}

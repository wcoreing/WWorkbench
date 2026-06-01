import { useCallback, useState, type MutableRefObject } from 'react'

/** useHttpDiscardConfirm 未保存变更确认（替代 Wails 不可用的 window.confirm）。 */
export function useHttpDiscardConfirm(dirtyRef: MutableRefObject<boolean>) {
  const [pending, setPending] = useState<(() => void) | null>(null)

  /** runWithDiscardCheck 有未保存修改时弹窗确认，否则直接执行。 */
  const runWithDiscardCheck = useCallback(
    (action: () => void) => {
      if (!dirtyRef.current) {
        action()
        return
      }
      setPending(() => action)
    },
    [dirtyRef],
  )

  const confirmDiscard = useCallback(() => {
    const action = pending
    setPending(null)
    dirtyRef.current = false
    action?.()
  }, [pending, dirtyRef])

  const cancelDiscard = useCallback(() => setPending(null), [])

  return { discardOpen: pending != null, runWithDiscardCheck, confirmDiscard, cancelDiscard }
}

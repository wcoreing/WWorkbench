import { useCallback, useRef, useState } from 'react'
import type { TransferConflict } from '../../api/types'
import { SftpConflictDialog, type ConflictAction } from './SftpConflictDialog'

/** useSftpConflictResolver 逐个解析传输冲突 */
export function useSftpConflictResolver() {
  const [state, setState] = useState<{
    conflict: TransferConflict
    kind: 'upload' | 'download'
    remaining: number
  } | null>(null)
  const resolverRef = useRef<((action: ConflictAction) => void) | null>(null)

  const ask = useCallback(
    (kind: 'upload' | 'download', conflict: TransferConflict, remaining: number) =>
      new Promise<ConflictAction>((resolve) => {
        resolverRef.current = resolve
        setState({ conflict, kind, remaining })
      }),
    []
  )

  const answer = useCallback((action: ConflictAction) => {
    setState(null)
    resolverRef.current?.(action)
    resolverRef.current = null
  }, [])

  const dialog = state ? (
    <SftpConflictDialog
      open
      kind={state.kind}
      conflict={state.conflict}
      remaining={state.remaining}
      onAction={answer}
    />
  ) : null

  return { ask, dialog }
}

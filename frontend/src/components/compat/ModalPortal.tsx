import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getWorkbenchOverlayRoot } from './overlayRoot'

interface Props {
  children: ReactNode
}

/** ModalPortal 将弹层挂到工作台叠加层，随界面字号一起缩放。 */
export function ModalPortal({ children }: Props) {
  const [root, setRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setRoot(getWorkbenchOverlayRoot())
  }, [])

  if (!root) return null
  return createPortal(children, root)
}

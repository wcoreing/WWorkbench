import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  children: ReactNode
}

/** ModalPortal 将弹层挂到 document.body，避免侧栏 overflow 影响 fixed 定位与点击。 */
export function ModalPortal({ children }: Props) {
  return createPortal(children, document.body)
}

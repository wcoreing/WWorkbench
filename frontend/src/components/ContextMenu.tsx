import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const PAD = 8
/** 相对指针右偏，避免菜单压在光标下误点首项。 */
const ANCHOR_OFFSET_X = 16

/** clampContextMenuPosition 将菜单限制在视口内，仅按溢出量微调。 */
export function clampContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const maxX = Math.max(PAD, window.innerWidth - PAD - width)
  const maxY = Math.max(PAD, window.innerHeight - PAD - height)
  return {
    x: Math.min(Math.max(x, PAD), maxX),
    y: Math.min(Math.max(y, PAD), maxY),
  }
}

interface Props {
  x: number
  y: number
  children: ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
}

/** ContextMenu 挂到 body，避开壳层 zoom 与 client 坐标错位。 */
export function ContextMenu({ x, y, children, className = 'wn-context-menu', onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const ax = x + ANCHOR_OFFSET_X
  const [pos, setPos] = useState({ x: ax, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      setPos({ x: ax, y })
      return
    }
    el.style.left = `${ax}px`
    el.style.top = `${y}px`
    const rect = el.getBoundingClientRect()
    setPos(clampContextMenuPosition(ax, y, rect.width, rect.height))
  }, [ax, y])

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{ left: pos.x, top: pos.y }}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}

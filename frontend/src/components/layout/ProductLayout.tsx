import type { ReactNode } from 'react'
import { ResizeHandle } from './ResizeHandle'
import { useResizable } from './useResizable'
import './layout.css'

type Props = {
  storageKey: string
  sidebar: ReactNode
  children: ReactNode
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  showSidebar?: boolean
  resizeTitle?: string
  sidebarClassName?: string
  /** 受控侧栏宽度（与 onResizeStart 成对传入） */
  width?: number
  onResizeStart?: (e: React.MouseEvent) => void
}

/** 产品线通用：可拖宽度侧栏 + 主区 */
export function ProductLayout({
  storageKey,
  sidebar,
  children,
  defaultWidth = 220,
  minWidth = 180,
  maxWidth = 480,
  showSidebar = true,
  resizeTitle,
  sidebarClassName,
  width: widthProp,
  onResizeStart: onResizeStartProp,
}: Props) {
  const internal = useResizable({
    axis: 'x',
    storageKey,
    defaultSize: defaultWidth,
    min: minWidth,
    max: maxWidth,
  })
  const controlled = widthProp != null && onResizeStartProp != null
  const size = controlled ? widthProp : internal.size
  const onResizeStart = controlled ? onResizeStartProp : internal.onResizeStart

  if (!showSidebar) {
    return <div className="product-body wn-product-layout">{children}</div>
  }

  return (
    <div className="product-body wn-product-layout">
      <aside
        className={['app-sidebar', 'wn-product-sidebar', sidebarClassName].filter(Boolean).join(' ')}
        style={{ width: size, minWidth: size }}
      >
        {sidebar}
      </aside>
      <ResizeHandle axis="x" onMouseDown={onResizeStart} title={resizeTitle} />
      <div className="wn-product-main">{children}</div>
    </div>
  )
}

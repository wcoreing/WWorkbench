import type { ResizeAxis } from './useResizable'
import './layout.css'

type Props = {
  axis: ResizeAxis
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  title?: string
  className?: string
}

/** 统一拖拽分隔条；可绑定双击（如收起面板） */
export function ResizeHandle({ axis, onMouseDown, onDoubleClick, title, className }: Props) {
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      className={['wn-resize-handle', `wn-resize-handle-${axis}`, className].filter(Boolean).join(' ')}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title={title}
    />
  )
}

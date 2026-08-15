import type { ResizeAxis } from './useResizable'
import './layout.css'
import { pressProps } from '../compat'

type Props = {
  axis?: ResizeAxis
  onToggle: () => void
  title?: string
  className?: string
}

/** 面板标题栏上的收起按钮（可发现的主入口；分隔条双击为快捷） */
export function PaneCollapseButton({ axis = 'x', onToggle, title, className }: Props) {
  return (
    <button
      type="button"
      className={['wn-pane-collapse-btn', `wn-pane-collapse-btn-${axis}`, className]
        .filter(Boolean)
        .join(' ')}
      title={title}
      aria-label={title}
      aria-expanded
      {...pressProps(onToggle)}
    >
      <span className={`tree-chevron wn-collapse-chevron is-${axis} is-expanded`} aria-hidden />
    </button>
  )
}

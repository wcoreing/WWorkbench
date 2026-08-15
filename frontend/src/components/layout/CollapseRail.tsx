import type { ResizeAxis } from './useResizable'
import './layout.css'
import { pressProps } from '../compat'

type Props = {
  axis: ResizeAxis
  onToggle: () => void
  /** 收起轨上显示的短标题 */
  label?: string
  title?: string
  className?: string
}

/**
 * 收起态展开轨：与分隔条同层。
 * 展开态不单独占位，由分隔条双击收起。
 */
export function CollapseRail({ axis, onToggle, label, title, className }: Props) {
  return (
    <button
      type="button"
      className={['wn-collapse-rail', `wn-collapse-rail-${axis}`, className].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
      aria-expanded={false}
      {...pressProps(onToggle)}
    >
      <span className={`tree-chevron wn-collapse-chevron is-${axis} is-collapsed`} aria-hidden />
      {label ? <span className="wn-collapse-rail-label">{label}</span> : null}
    </button>
  )
}

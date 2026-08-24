import type { CSSProperties } from 'react'

export interface LoadingProps {
  /** 文案；iconOnly 时不渲染 */
  label?: string
  variant?: 'inline' | 'pane' | 'overlay'
  /** 仅显示 spinner，常用于按钮内 */
  iconOnly?: boolean
  size?: 'sm' | 'md'
  className?: string
  style?: CSSProperties
}

/** Loading 统一加载态：inline 行内、pane 面板居中、overlay 遮罩。 */
export function Loading({
  label,
  variant = 'inline',
  iconOnly = false,
  size = 'md',
  className,
  style,
}: LoadingProps) {
  const cls = [
    'wn-loading',
    `wn-loading-${variant}`,
    `wn-loading-${size}`,
    iconOnly ? 'wn-loading-icon-only' : '',
    variant === 'pane' ? 'pane-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} style={style} role="status" aria-live="polite" aria-busy="true">
      <span className="wn-loading-spinner" aria-hidden="true" />
      {!iconOnly && label ? <span className="wn-loading-label">{label}</span> : null}
    </div>
  )
}

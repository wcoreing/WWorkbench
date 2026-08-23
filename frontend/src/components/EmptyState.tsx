import type { CSSProperties, ReactNode } from 'react'
import { pressProps } from './compat'

export interface EmptyStateAction {
  label: string
  onPress: () => void
  /** 主操作：强调样式，一处空态最多一个 */
  primary?: boolean
  icon?: ReactNode
}

interface Props {
  title: string
  hint?: string
  actions?: EmptyStateAction[]
  /** inline 用于侧栏窄栏：左对齐、按钮竖排 */
  variant?: 'pane' | 'inline'
  className?: string
  style?: CSSProperties
}

/** EmptyState 空态：一句现状 + 可点的下一步，替代只讲道理的说明文案。 */
export function EmptyState({ title, hint, actions = [], variant = 'pane', className, style }: Props) {
  const cls = [
    variant === 'pane' ? 'pane-empty' : 'empty-hint',
    'wn-empty',
    `wn-empty-${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={style}>
      <span className="wn-empty-title">{title}</span>
      {hint && <span className="wn-empty-hint">{hint}</span>}
      {actions.length > 0 && (
        <div className="wn-empty-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`wn-btn wn-btn-sm ${action.primary ? 'wn-btn-primary' : 'wn-btn-ghost'}`}
              {...pressProps(action.onPress)}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import type { AgentMention, AgentMentionKind } from './agentMention'
import { mentionKindShort } from './agentMention'

interface Props {
  mentions: AgentMention[]
  /** 气泡内联样式 */
  inline?: boolean
  /** 输入栏线程绑定样式（带标题与移除） */
  thread?: boolean
  threadLabel?: string
  onRemove?: (id: string, kind: AgentMentionKind) => void
  removeLabel?: string
  className?: string
}

/** AgentMentionChips @ 资源 chip（气泡与输入区共用）。 */
export function AgentMentionChips({
  mentions,
  inline,
  thread,
  threadLabel,
  onRemove,
  removeLabel,
  className,
}: Props) {
  if (!mentions.length) return null
  const rootClass = [
    'agent-mention-chips',
    inline ? 'agent-mention-chips-inline' : '',
    thread ? 'agent-mention-chips-thread' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={rootClass}>
      {thread && threadLabel ? <span className="agent-thread-mentions-label">{threadLabel}</span> : null}
      {mentions.map((m) => (
        <span key={`${m.kind}-${m.id}`} className={`agent-mention-chip agent-mention-chip-${m.kind}`}>
          <span className="agent-mention-chip-kind">{mentionKindShort(m.kind)}</span>
          <span className="agent-mention-chip-label">{m.label}</span>
          {onRemove ? (
            <button
              type="button"
              className="agent-mention-chip-remove"
              aria-label={removeLabel ?? 'Remove'}
              onClick={() => onRemove(m.id, m.kind)}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}

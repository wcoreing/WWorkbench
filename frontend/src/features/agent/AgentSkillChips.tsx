interface Props {
  skillIds: string[]
  labels?: Record<string, string>
  muted?: boolean
  className?: string
  /** 输入栏线程绑定样式（带标题与移除）。 */
  thread?: boolean
  threadLabel?: string
  onRemove?: (id: string) => void
  removeLabel?: string
}

/** AgentSkillChips 技能 / 挂载 chip（气泡与输入区共用）。 */
export function AgentSkillChips({
  skillIds,
  labels,
  muted,
  className,
  thread,
  threadLabel,
  onRemove,
  removeLabel,
}: Props) {
  if (!skillIds.length) return null
  const rootClass = thread
    ? ['agent-mention-chips', 'agent-mention-chips-thread', 'agent-mention-chips-skills', className]
        .filter(Boolean)
        .join(' ')
    : ['agent-mention-chips', 'agent-mention-chips-inline', 'agent-mention-chips-skills', className]
        .filter(Boolean)
        .join(' ')
  return (
    <div className={rootClass}>
      {thread && threadLabel ? <span className="agent-thread-mentions-label">{threadLabel}</span> : null}
      {skillIds.map((id) => (
        <span
          key={id}
          className={`agent-mention-chip agent-mention-chip-skill${muted ? ' agent-mention-chip-muted' : ''}`}
        >
          <span className="agent-mention-chip-kind">/</span>
          <span className="agent-mention-chip-label">{labels?.[id] ?? id}</span>
          {onRemove ? (
            <button
              type="button"
              className="agent-mention-chip-remove"
              aria-label={removeLabel ?? 'Remove'}
              onClick={() => onRemove(id)}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  )
}

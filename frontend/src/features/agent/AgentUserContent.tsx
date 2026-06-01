import type { AgentMention } from './agentMention'

interface Props {
  content: string
  mentions?: AgentMention[]
}

/** AgentUserContent 渲染用户消息（@ 资源 chip + 文本）。 */
export function AgentUserContent({ content, mentions }: Props) {
  return (
    <div className="agent-user-content">
      {mentions && mentions.length > 0 && (
        <div className="agent-mention-chips agent-mention-chips-inline">
          {mentions.map((m) => (
            <span key={`${m.kind}-${m.id}`} className={`agent-mention-chip agent-mention-chip-${m.kind}`}>
              <span className="agent-mention-chip-kind">
                {m.kind === 'ssh'
                  ? 'SSH'
                  : m.kind === 'docker'
                    ? 'DK'
                    : m.kind === 'log'
                      ? 'LOG'
                      : m.kind === 'http'
                        ? 'API'
                        : 'DB'}
              </span>
              <span className="agent-mention-chip-label">{m.label}</span>
            </span>
          ))}
        </div>
      )}
      {content.trim() ? <p className="agent-plain">{content}</p> : null}
    </div>
  )
}

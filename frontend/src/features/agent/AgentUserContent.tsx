import type { AgentMention } from './agentMention'

interface Props {
  content: string
  mentions?: AgentMention[]
  images?: { mime: string; data: string }[]
}

/** AgentUserContent 渲染用户消息（@ 资源 chip + 图片 + 文本）。 */
export function AgentUserContent({ content, mentions, images }: Props) {
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
      {images && images.length > 0 && (
        <div className="agent-msg-images">
          {images.map((img, i) => (
            <img key={`${img.mime}-${i}`} src={img.data} alt="" className="agent-msg-image" />
          ))}
        </div>
      )}
      {content.trim() ? <p className="agent-plain">{content}</p> : null}
    </div>
  )
}

import type { AgentMention } from './agentMention'
import { AgentMentionChips } from './AgentMentionChips'
import { AgentSkillChips } from './AgentSkillChips'

interface Props {
  content: string
  mentions?: AgentMention[]
  skillIds?: string[]
  skillLabels?: Record<string, string>
  images?: { mime: string; data: string }[]
}

/** AgentUserContent 渲染用户消息（@ 资源 chip + 技能 + 图片 + 文本）。 */
export function AgentUserContent({ content, mentions, skillIds, skillLabels, images }: Props) {
  return (
    <div className="agent-user-content">
      <AgentSkillChips skillIds={skillIds ?? []} labels={skillLabels} />
      <AgentMentionChips mentions={mentions ?? []} inline />
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

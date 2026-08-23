import { useMemo } from 'react'
import type { AgentMention } from './agentMention'
import { AgentRichContent } from './AgentRichContent'
import { AgentUserContent } from './AgentUserContent'
import { AgentChoicePanel } from './AgentChoicePanel'
import { AgentSkillChips } from './AgentSkillChips'
import { extractAgentChoices } from './agentChoice'

interface Props {
  content: string
  role: 'user' | 'assistant' | 'system'
  mentions?: AgentMention[]
  skillIds?: string[]
  skillLabels?: Record<string, string>
  images?: { mime: string; data: string }[]
  /** 可点选项：仅最新助手气泡启用 */
  choiceDisabled?: boolean
  onChoiceDraft?: (text: string) => void
}

/** AgentMessageContent 渲染对话消息。 */
export function AgentMessageContent({
  content,
  role,
  mentions,
  skillIds,
  skillLabels,
  images,
  choiceDisabled,
  onChoiceDraft,
}: Props) {
  const choice = useMemo(
    () => (role === 'assistant' ? extractAgentChoices(content) : null),
    [content, role],
  )

  if (role === 'assistant') {
    return (
      <>
        <AgentSkillChips
          skillIds={skillIds ?? []}
          labels={skillLabels}
          muted
          className="agent-turn-skills"
        />
        <AgentRichContent content={choice?.body || content} />
        {choice && choice.questions.length > 0 && onChoiceDraft && (
          <AgentChoicePanel
            questions={choice.questions}
            disabled={choiceDisabled}
            onDraft={onChoiceDraft}
          />
        )}
      </>
    )
  }

  if (role === 'user') {
    return (
      <AgentUserContent
        content={content}
        mentions={mentions}
        skillIds={skillIds}
        skillLabels={skillLabels}
        images={images}
      />
    )
  }

  return <p className="agent-plain agent-plain-muted">{content}</p>
}

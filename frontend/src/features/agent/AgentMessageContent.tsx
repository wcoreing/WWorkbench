import { useMemo } from 'react'
import type { AgentMention } from './agentMention'
import { AgentRichContent } from './AgentRichContent'
import { AgentUserContent } from './AgentUserContent'
import { AgentChoicePanel } from './AgentChoicePanel'
import { extractAgentChoices } from './agentChoice'

interface Props {
  content: string
  role: 'user' | 'assistant' | 'system'
  mentions?: AgentMention[]
  /** 可点选项：仅最新助手气泡启用 */
  choiceDisabled?: boolean
  onChoiceSend?: (text: string) => void
}

/** AgentMessageContent 渲染对话消息。 */
export function AgentMessageContent({
  content,
  role,
  mentions,
  choiceDisabled,
  onChoiceSend,
}: Props) {
  const choice = useMemo(
    () => (role === 'assistant' ? extractAgentChoices(content) : null),
    [content, role],
  )

  if (role === 'assistant') {
    return (
      <>
        <AgentRichContent content={choice?.body || content} />
        {choice && choice.questions.length > 0 && onChoiceSend && (
          <AgentChoicePanel
            questions={choice.questions}
            disabled={choiceDisabled}
            onSend={onChoiceSend}
          />
        )}
      </>
    )
  }

  if (role === 'user') {
    return <AgentUserContent content={content} mentions={mentions} />
  }

  return <p className="agent-plain agent-plain-muted">{content}</p>
}

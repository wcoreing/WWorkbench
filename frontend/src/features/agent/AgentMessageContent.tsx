import type { AgentMention } from './agentMention'
import { AgentRichContent } from './AgentRichContent'
import { AgentUserContent } from './AgentUserContent'

interface Props {
  content: string
  role: 'user' | 'assistant' | 'system'
  mentions?: AgentMention[]
}

/** AgentMessageContent 渲染对话消息。 */
export function AgentMessageContent({ content, role, mentions }: Props) {
  if (role === 'assistant') {
    return <AgentRichContent content={content} />
  }

  if (role === 'user') {
    return <AgentUserContent content={content} mentions={mentions} />
  }

  return <p className="agent-plain agent-plain-muted">{content}</p>
}

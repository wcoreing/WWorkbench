import { memo } from 'react'
import type { AgentChatLine } from '../../stores/agentStore'
import { useAgentStore } from '../../stores/agentStore'
import type { AgentMention } from './agentMention'
import { AgentMessageContent } from './AgentMessageContent'
import { AgentTurnTools } from './AgentTurnTools'

interface Props {
  line: AgentChatLine
  threadId: string
  isLastAssistant: boolean
  busy: boolean
  hasToolChoice: boolean
  skillCatalog: Record<string, string>
  t: (key: string, params?: Record<string, string | number>) => string
  onSaveToNotebook: (content: string) => void
  onChoiceDraft?: (text: string) => void
}

function historyRef(threadId: string, seq?: number): string {
  const tid = threadId.trim()
  if (!tid) return seq && seq > 0 ? `#${seq}` : ''
  if (seq && seq > 0) return `${tid}#${seq}`
  return tid
}

function shortThread(threadId: string): string {
  const t = threadId.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 8)}…`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** 流式正文：单独订阅 draft，避免每条 token 重渲染历史消息。 */
function AgentStreamingPlain({ lineId }: { lineId: string }) {
  const draft = useAgentStore((s) => (s.streamingLineId === lineId ? s.streamingDraft : ''))
  if (!draft) return null
  return <p className="agent-plain agent-plain-streaming">{draft}</p>
}

/** AgentChatTurn 单条对话回合（memo 隔离历史消息）。 */
export const AgentChatTurn = memo(function AgentChatTurn({
  line,
  threadId,
  isLastAssistant,
  busy,
  hasToolChoice,
  skillCatalog,
  t,
  onSaveToNotebook,
  onChoiceDraft,
}: Props) {
  const streamingLineId = useAgentStore((s) => s.streamingLineId)
  const isStreaming = streamingLineId === line.id
  const href = historyRef(threadId, line.seq)
  const hasContent =
    Boolean(line.content.trim()) ||
    isStreaming ||
    Boolean(line.images?.length) ||
    Boolean(line.skillIds?.length) ||
    line.role === 'system'

  return (
    <div className={`agent-turn agent-turn-${line.role}`}>
      {(line.role === 'assistant' || line.role === 'user') && (
        <div className="agent-turn-meta">
          {line.role === 'assistant' && (
            <span className="agent-turn-label">{t('agent.assistantLabel')}</span>
          )}
          {line.role === 'user' && (
            <span className="agent-turn-label agent-turn-label-user">{t('agent.youLabel')}</span>
          )}
          {href ? (
            <button
              type="button"
              className="agent-turn-histid"
              title={t('agent.copyHistoryId')}
              onClick={() => void copyText(href)}
            >
              {line.seq && line.seq > 0 ? (
                <>
                  <span className="agent-turn-histid-thread">{shortThread(threadId)}</span>
                  <span className="agent-turn-histid-seq">#{line.seq}</span>
                </>
              ) : (
                <span className="agent-turn-histid-thread">{shortThread(threadId)}</span>
              )}
            </button>
          ) : null}
        </div>
      )}
      {line.role === 'assistant' && line.tools && line.tools.length > 0 ? (
        <AgentTurnTools tools={line.tools} />
      ) : null}
      {hasContent && (
        <div
          className={
            line.role === 'system'
              ? 'agent-bubble agent-bubble-system'
              : `agent-bubble agent-bubble-${line.role}`
          }
        >
          {isStreaming && line.role === 'assistant' ? (
            <AgentStreamingPlain lineId={line.id} />
          ) : (
            <AgentMessageContent
              content={line.content}
              role={line.role}
              mentions={line.mentions}
              skillIds={line.skillIds}
              skillLabels={skillCatalog}
              images={line.images}
              choiceDisabled={busy || !isLastAssistant}
              hideInlineChoice={hasToolChoice && isLastAssistant}
              onChoiceDraft={line.role === 'assistant' ? onChoiceDraft : undefined}
            />
          )}
          {line.role === 'assistant' &&
            line.content.trim() &&
            !busy && (
              <div className="agent-turn-actions">
                <button
                  type="button"
                  className="wn-btn wn-btn-xs wn-btn-ghost"
                  onClick={() => onSaveToNotebook(line.content)}
                >
                  {t('agent.saveToNotebook')}
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  )
})

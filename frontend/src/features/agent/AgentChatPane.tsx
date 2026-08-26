import type { RefObject } from 'react'
import type { AgentConfirmEvent, AgentOfferChoicesEvent } from '../../api/agentEvents'
import type { AgentChatLine } from '../../stores/agentStore'
import type { AgentChatMode } from './agentChatMode'
import type { AgentMention, AgentMentionKind } from './agentMention'
import { AgentConfirmPanel } from './AgentConfirmPanel'
import { AgentChoicePanel, type ChoiceSubmitAnswer } from './AgentChoicePanel'
import type { AgentChoiceQuestion } from './agentChoice'
import { AgentInputBar } from './AgentInputBar'
import { AgentMessageContent } from './AgentMessageContent'
import { AgentTurnTools } from './AgentTurnTools'
import type { ChatImage } from './agentImages'

/** historyRef 供查日志：threadId#seq */
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

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  lines: AgentChatLine[]
  busy: boolean
  chatMode: AgentChatMode
  skillCatalog: Record<string, string>
  threadMentions: AgentMention[]
  threadSkillIds: string[]
  autoMentions: AgentMention[]
  pending: AgentConfirmEvent | null
  pendingChoice: AgentOfferChoicesEvent | null
  threadId: string
  modelName: string
  provider: string
  scrollRef: RefObject<HTMLDivElement>
  onMessagesScroll: () => void
  onChoiceDraft: (text: string) => void
  onChoiceSubmit: (answers: ChoiceSubmitAnswer[]) => void
  onSaveToNotebook: (content: string) => void
  onConfirm: (ok: boolean) => void
  onModeChange: (mode: AgentChatMode) => void
  onModelChange: (id: string) => void
  onSend: (
    text: string,
    mentions: AgentMention[],
    images: ChatImage[],
    skillIds?: string[],
  ) => void | Promise<void>
  onStop: () => void
  onUnbindThreadMention: (id: string, kind: AgentMentionKind) => void
  onUnbindThreadSkill: (id: string) => void
}

function offerEventToQuestions(evt: AgentOfferChoicesEvent): AgentChoiceQuestion[] {
  return evt.items.map((it) => ({
    n: it.n,
    id: it.pendingId,
    mode: it.mode,
    prompt: it.prompt || it.summary || '',
    options: (it.options || []).map((o) => ({ key: o.key, label: o.label })),
    placeholder: it.placeholder,
  }))
}

/** AgentChatPane 对话区：轨迹、消息、确认、输入栏。 */
export function AgentChatPane({
  t,
  lines,
  busy,
  chatMode,
  skillCatalog,
  threadMentions,
  threadSkillIds,
  autoMentions,
  pending,
  pendingChoice,
  threadId,
  modelName,
  provider,
  scrollRef,
  onMessagesScroll,
  onChoiceDraft,
  onChoiceSubmit,
  onSaveToNotebook,
  onConfirm,
  onModeChange,
  onModelChange,
  onSend,
  onStop,
  onUnbindThreadMention,
  onUnbindThreadSkill,
}: Props) {
  const hasToolChoice = Boolean(pendingChoice && pendingChoice.items.length > 0)
  return (
    <div className="agent-chat-pane">
      <div className="agent-messages" ref={scrollRef} onScroll={onMessagesScroll}>
        {lines.length === 0 && <div className="agent-empty">{t('agent.hint')}</div>}
        {lines.map((line, idx) => {
          const isLastAssistant =
            line.role === 'assistant' && !lines.slice(idx + 1).some((l) => l.role === 'assistant')
          const href = historyRef(threadId, line.seq)
          return (
            <div key={line.id} className={`agent-turn agent-turn-${line.role}`}>
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
              {(line.content.trim() ||
                (line.images && line.images.length > 0) ||
                (line.skillIds && line.skillIds.length > 0) ||
                line.role === 'system') && (
                <div
                  className={
                    line.role === 'system'
                      ? 'agent-bubble agent-bubble-system'
                      : `agent-bubble agent-bubble-${line.role}`
                  }
                >
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
                  {(line.role === 'assistant' || line.role === 'user') &&
                    (line.content.trim() ||
                      (line.images && line.images.length > 0) ||
                      (line.skillIds && line.skillIds.length > 0)) &&
                    !busy && (
                      <div className="agent-turn-actions">
                        {line.role === 'assistant' && line.content.trim() && (
                          <button
                            type="button"
                            className="wn-btn wn-btn-xs wn-btn-ghost"
                            onClick={() => onSaveToNotebook(line.content)}
                          >
                            {t('agent.saveToNotebook')}
                          </button>
                        )}
                      </div>
                    )}
                </div>
              )}
            </div>
          )
        })}
        {busy && (
          <div className="agent-turn agent-turn-system">
            <span className="agent-thinking">
              <span className="agent-thinking-dot" />
              <span className="agent-thinking-dot" />
              <span className="agent-thinking-dot" />
              {chatMode === 'ask'
                ? t('agent.modeAsk')
                : chatMode === 'plan'
                  ? t('agent.modePlan')
                  : t('agent.modeAgent')}
              {' · '}
              {t('agent.thinking')}
            </span>
          </div>
        )}
      </div>

      {pending && (
        <AgentConfirmPanel
          pending={pending}
          onApprove={() => onConfirm(true)}
          onReject={() => onConfirm(false)}
        />
      )}

      {hasToolChoice && pendingChoice && (
        <div className="agent-choice-pending">
          <AgentChoicePanel
            questions={offerEventToQuestions(pendingChoice)}
            disabled={busy}
            onSubmit={onChoiceSubmit}
          />
        </div>
      )}

      <AgentInputBar
        busy={busy}
        threadId={threadId}
        autoMentions={autoMentions}
        threadMentions={threadMentions}
        mode={chatMode}
        onModeChange={onModeChange}
        modelName={modelName}
        provider={provider}
        onModelChange={onModelChange}
        onSend={onSend}
        onStop={onStop}
        onUnbindThreadMention={onUnbindThreadMention}
        threadSkillIds={threadSkillIds}
        onUnbindThreadSkill={onUnbindThreadSkill}
      />
    </div>
  )
}

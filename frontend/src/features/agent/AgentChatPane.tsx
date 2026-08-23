import type { RefObject } from 'react'
import type { AgentConfirmEvent } from '../../api/agentEvents'
import type { AgentChatLine, AgentToolStep } from '../../stores/agentStore'
import type { AgentChatMode } from './agentChatMode'
import type { AgentMention, AgentMentionKind } from './agentMention'
import { AgentConfirmPanel } from './AgentConfirmPanel'
import { AgentInputBar } from './AgentInputBar'
import { AgentMessageContent } from './AgentMessageContent'
import { AgentToolTrace } from './AgentToolTrace'
import type { ChatImage } from './agentImages'

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  lines: AgentChatLine[]
  busy: boolean
  chatMode: AgentChatMode
  toolSteps: AgentToolStep[]
  skillCatalog: Record<string, string>
  threadMentions: AgentMention[]
  threadSkillIds: string[]
  autoMentions: AgentMention[]
  pending: AgentConfirmEvent | null
  threadId: string
  modelName: string
  provider: string
  scrollRef: RefObject<HTMLDivElement>
  onMessagesScroll: () => void
  onChoiceDraft: (text: string) => void
  onSaveToNotebook: (content: string) => void
  onRewind: (seq: number) => void
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

/** AgentChatPane 对话区：轨迹、消息、确认、输入栏。 */
export function AgentChatPane({
  t,
  lines,
  busy,
  chatMode,
  toolSteps,
  skillCatalog,
  threadMentions,
  threadSkillIds,
  autoMentions,
  pending,
  threadId,
  modelName,
  provider,
  scrollRef,
  onMessagesScroll,
  onChoiceDraft,
  onSaveToNotebook,
  onRewind,
  onConfirm,
  onModeChange,
  onModelChange,
  onSend,
  onStop,
  onUnbindThreadMention,
  onUnbindThreadSkill,
}: Props) {
  return (
    <div className="agent-chat-pane">
      <AgentToolTrace steps={toolSteps} />
      <div className="agent-messages" ref={scrollRef} onScroll={onMessagesScroll}>
        {lines.length === 0 && <div className="agent-empty">{t('agent.hint')}</div>}
        {lines.map((line, idx) => {
          const isLastAssistant =
            line.role === 'assistant' && !lines.slice(idx + 1).some((l) => l.role === 'assistant')
          return (
            <div key={line.id} className={`agent-turn agent-turn-${line.role}`}>
              {line.role === 'assistant' && (
                <span className="agent-turn-label">{t('agent.assistantLabel')}</span>
              )}
              {line.role === 'user' && (
                <span className="agent-turn-label agent-turn-label-user">{t('agent.youLabel')}</span>
              )}
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
                  onChoiceDraft={line.role === 'assistant' ? onChoiceDraft : undefined}
                />
                {(line.role === 'assistant' || line.role === 'user') &&
                  (line.content.trim() ||
                    (line.images && line.images.length > 0) ||
                    (line.skillIds && line.skillIds.length > 0)) &&
                  !busy && (
                    <div className="agent-turn-actions">
                      {line.role === 'assistant' && (
                        <button
                          type="button"
                          className="wn-btn wn-btn-xs wn-btn-ghost"
                          onClick={() => onSaveToNotebook(line.content)}
                        >
                          {t('agent.saveToNotebook')}
                        </button>
                      )}
                      {!!line.seq && (
                        <button
                          type="button"
                          className="wn-btn wn-btn-xs wn-btn-ghost"
                          title={t('agent.rewindConfirm')}
                          onClick={() => onRewind(line.seq!)}
                        >
                          {t('agent.rewindHere')}
                        </button>
                      )}
                    </div>
                  )}
              </div>
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

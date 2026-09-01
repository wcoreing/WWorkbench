import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import type { AgentConfirmEvent, AgentOfferChoicesEvent } from '../../api/agentEvents'
import type { AgentChatLine } from '../../stores/agentStore'
import type { AgentChatMode } from './agentChatMode'
import type { AgentMention, AgentMentionKind } from './agentMention'
import { AgentConfirmPanel } from './AgentConfirmPanel'
import type { ChoiceSubmitAnswer } from './AgentChoicePanel'
import type { AgentChoiceQuestion } from './agentChoice'
import { AgentInputBar } from './AgentInputBar'
import { AgentChatTurn } from './AgentChatTurn'
import type { ChatImage } from './agentImages'

const VIRTUALIZE_MIN = 24
const TURN_ESTIMATE_PX = 108

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

function lastAssistantIndex(lines: AgentChatLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].role === 'assistant') return i
  }
  return -1
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
  const lastAssistantIdx = lastAssistantIndex(lines)
  const useVirtual = lines.length >= VIRTUALIZE_MIN
  const listRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TURN_ESTIMATE_PX,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  const renderTurn = (line: AgentChatLine, idx: number) => {
    const toolChoiceQuestions =
      idx === lastAssistantIdx && pendingChoice?.items.length
        ? offerEventToQuestions(pendingChoice)
        : undefined
    return (
      <AgentChatTurn
        key={line.id}
        line={line}
        threadId={threadId}
        isLastAssistant={idx === lastAssistantIdx}
        busy={busy}
        toolChoiceQuestions={toolChoiceQuestions}
        skillCatalog={skillCatalog}
        t={t}
        onSaveToNotebook={onSaveToNotebook}
        onChoiceDraft={onChoiceDraft}
        onChoiceSubmit={onChoiceSubmit}
      />
    )
  }

  return (
    <div className="agent-chat-pane">
      <div className="agent-messages" ref={scrollRef} onScroll={onMessagesScroll}>
        {lines.length === 0 && <div className="agent-empty">{t('agent.hint')}</div>}
        {useVirtual ? (
          <div
            ref={listRef}
            className="agent-messages-virtual"
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={lines[item.index].id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="agent-messages-virtual-item"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {renderTurn(lines[item.index], item.index)}
              </div>
            ))}
          </div>
        ) : (
          lines.map((line, idx) => renderTurn(line, idx))
        )}
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

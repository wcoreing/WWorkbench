import { useMemo, type RefObject } from 'react'
import type { AgentChatLine, AgentSessionPhase } from '../../stores/agentStore'
import { useAgentStore } from '../../stores/agentStore'
import type { AgentChatMode } from './agentChatMode'
import type { AgentMention, AgentMentionKind } from './agentMention'
import { pressProps } from '../../components/compat'
import { AgentChoicePanel, type ChoiceSubmitAnswer } from './AgentChoicePanel'
import type { AgentChoiceQuestion } from './agentChoice'
import { AgentInputBar } from './AgentInputBar'
import { AgentChatTurn } from './AgentChatTurn'
import { AgentStarter, type AgentStarterItem } from './AgentStarter'
import type { ChatImage } from './agentImages'
import { coalesceToolOnlyLines } from './agentLines'

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  lines: AgentChatLine[]
  sessionPhase: AgentSessionPhase
  active: boolean
  runningToolCount: number
  chatMode: AgentChatMode
  skillCatalog: Record<string, string>
  threadMentions: AgentMention[]
  threadSkillIds: string[]
  autoMentions: AgentMention[]
  choiceQuestions?: AgentChoiceQuestion[]
  threadId: string
  modelName: string
  provider: string
  scrollRef: RefObject<HTMLDivElement>
  /** 列表底部哨兵：贴底跟滚用 */
  endRef: RefObject<HTMLDivElement>
  onMessagesScroll: () => void
  onChoiceSubmit: (answers: ChoiceSubmitAnswer[]) => void
  onModeChange: (mode: AgentChatMode) => void
  onModelChange: (id: string) => void
  onSend: (
    text: string,
    mentions: AgentMention[],
    images: ChatImage[],
    skillIds?: string[],
    mode?: AgentChatMode,
  ) => void | Promise<void>
  onStop: () => void
  onUnbindThreadMention: (id: string, kind: AgentMentionKind) => void
  onClearThreadMentions: () => void
  onUnbindThreadSkill: (id: string) => void
  onSuggest?: (item: AgentStarterItem) => void
}

function lastAssistantIndex(lines: AgentChatLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].role === 'assistant') return i
  }
  return -1
}

/** 一轮助手回复只显示一次「助手」（跳过中间的 system；用户每条仍显示）。 */
function shouldShowRoleLabel(lines: AgentChatLine[], idx: number): boolean {
  const role = lines[idx]?.role
  if (role === 'user') return true
  if (role !== 'assistant') return false
  for (let i = idx - 1; i >= 0; i--) {
    const prev = lines[i].role
    if (prev === 'system') continue
    return prev !== 'assistant'
  }
  return true
}

/** AgentChatPane 对话区：轨迹、消息、选题 ActionRail、输入栏（无虚列表，避免工具展开留白）。 */
export function AgentChatPane({
  t,
  lines,
  sessionPhase,
  active,
  runningToolCount,
  chatMode,
  skillCatalog,
  threadMentions,
  threadSkillIds,
  autoMentions,
  choiceQuestions,
  threadId,
  modelName,
  provider,
  scrollRef,
  endRef,
  onMessagesScroll,
  onChoiceSubmit,
  onModeChange,
  onModelChange,
  onSend,
  onStop,
  onUnbindThreadMention,
  onClearThreadMentions,
  onUnbindThreadSkill,
  onSuggest,
}: Props) {
  const displayLines = useMemo(() => coalesceToolOnlyLines(lines), [lines])
  const lastAssistantIdx = lastAssistantIndex(displayLines)
  const streamingLineId = useAgentStore((s) => s.streamingLineId)
  const streamingDraft = useAgentStore((s) => s.streamingDraft)
  const showActionRail = Boolean(choiceQuestions?.length)
  const ENV_TOOL = /^(cursor_bridge|mcp)/
  const lastTools = lastAssistantIdx >= 0 ? displayLines[lastAssistantIdx].tools || [] : []
  const runningBusiness = lastTools.filter(
    (s) => s.status === 'running' && !ENV_TOOL.test(s.tool),
  )
  const runningEnvOnly =
    lastTools.some((s) => s.status === 'running' && ENV_TOOL.test(s.tool)) &&
    runningBusiness.length === 0
  const showStreamingIdle =
    sessionPhase === 'streaming' &&
    runningToolCount === 0 &&
    Boolean(streamingLineId) &&
    !streamingDraft.trim()

  return (
    <div className="agent-chat-pane">
      <div className="agent-messages" ref={scrollRef} onScroll={onMessagesScroll}>
        <div className="agent-messages-inner">
          {displayLines.length === 0 &&
            (onSuggest ? (
              <AgentStarter t={t} busy={active} onSuggest={onSuggest} />
            ) : (
              <div className="agent-empty">{t('agent.hint')}</div>
            ))}
          {displayLines.map((line, idx) => (
            <AgentChatTurn
              key={line.id}
              line={line}
              threadId={threadId}
              isLastAssistant={idx === lastAssistantIdx}
              showRoleLabel={shouldShowRoleLabel(displayLines, idx)}
              choiceDisabled={active || idx !== lastAssistantIdx}
              hideInlineChoice={Boolean(choiceQuestions?.length) && idx === lastAssistantIdx}
              skillCatalog={skillCatalog}
              t={t}
              onChoiceSubmit={onChoiceSubmit}
            />
          ))}
          {runningBusiness.length > 0 && (
            <div className="agent-turn agent-turn-system">
              <div className="agent-activity agent-activity-tools" role="status">
                <span className="agent-turn-tool-spinner" aria-hidden />
                <span className="agent-activity-label">
                  {runningBusiness.length === 1
                    ? t('agent.toolRunningOne', { name: runningBusiness[0].tool })
                    : t('agent.toolsRunning', { count: runningBusiness.length })}
                </span>
                {runningBusiness.length > 1 ? (
                  <span className="agent-activity-names">
                    {runningBusiness.map((s) => s.tool).join(' · ')}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          {runningEnvOnly && (
            <div className="agent-turn agent-turn-system">
              <span className="agent-activity">
                <span className="agent-turn-tool-spinner" aria-hidden />
                {t('agent.toolsPreparing')}
              </span>
            </div>
          )}
          {showStreamingIdle && (
            <div className="agent-turn agent-turn-system">
              <span className="agent-activity">{t('agent.thinking')}</span>
            </div>
          )}
          <div ref={endRef} className="agent-messages-end" aria-hidden />
        </div>
      </div>

      {showActionRail && choiceQuestions && choiceQuestions.length > 0 && (
        <div className="agent-action-rail" role="region" aria-label={t('agent.actionRail')}>
          <AgentChoicePanel
            questions={choiceQuestions}
            disabled={sessionPhase === 'streaming' || sessionPhase === 'tools'}
            onSubmit={onChoiceSubmit}
          />
        </div>
      )}

      {chatMode === 'plan' ? (
        <div className="agent-mode-banner" role="status">
          {t('agent.planModeBanner')}
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-primary"
            {...pressProps(() => onModeChange('agent'))}
          >
            {t('agent.switchToAgent')}
          </button>
        </div>
      ) : null}

      <AgentInputBar
        active={active}
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
        onClearThreadMentions={onClearThreadMentions}
        threadSkillIds={threadSkillIds}
        onUnbindThreadSkill={onUnbindThreadSkill}
      />
    </div>
  )
}

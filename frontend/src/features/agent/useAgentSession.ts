import { useCallback, useEffect, useRef } from 'react'
import { api } from '../../api/client'
import { subscribeAgentEvents, type AgentOfferChoicesEvent } from '../../api/agentEvents'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { nextAgentLineId, useAgentStore, type AgentChatLine, type AgentToolStep } from '../../stores/agentStore'
import { model } from '../../../wailsjs/go/models'
import {
  buildAutoMentions,
  filterEphemeralAutoMentions,
  mergeMentions,
  parseMentionsFromEvent,
  toContextMentions,
  type AgentMention,
} from './agentMention'
import { mergeSkillIds } from './agentSkillIds'
import type { AgentChatMode } from './agentChatMode'
import type { ChoiceSubmitAnswer } from './AgentChoicePanel'
import { joinChoiceSendTexts, type AgentChoiceQuestion } from './agentChoice'
import type { ChatImage } from './agentImages'

/** 入库用完整参数；一行摘要由 previewToolArgs 负责截断。 */
function storeArgs(args?: string): string | undefined {
  const a = args?.trim()
  return a || undefined
}

function mapToolStatus(status: string): AgentToolStep['status'] {
  // 写工具已自动执行；历史里残留的 need_confirm 按成功展示
  if (status === 'need_confirm') return 'ok'
  return (status || '') as AgentToolStep['status']
}

/** useAgentSession 对话会话：事件订阅、phase、send/stop/choose；写工具无确认。 */
export function useAgentSession(opts: {
  collapsed: boolean
  pinToBottom: () => void
}) {
  const { collapsed, pinToBottom } = opts
  const { t } = useI18n()
  const {
    activeProduct,
    session,
    activeConnectionId,
    connections,
    agentSurface,
    setStatusMessage,
  } = useAppStore()

  const threadId = useAgentStore((s) => s.threadId)
  const setThreadId = useAgentStore((s) => s.setThreadId)
  const lines = useAgentStore((s) => s.lines)
  const appendLine = useAgentStore((s) => s.appendLine)
  const setLines = useAgentStore((s) => s.setLines)
  const resetThread = useAgentStore((s) => s.resetThread)
  const beginStreaming = useAgentStore((s) => s.beginStreaming)
  const appendStreamDelta = useAgentStore((s) => s.appendStreamDelta)
  const finishStreaming = useAgentStore((s) => s.finishStreaming)
  const cancelStreaming = useAgentStore((s) => s.cancelStreaming)
  const pushToolStep = useAgentStore((s) => s.pushToolStep)
  const finishToolStep = useAgentStore((s) => s.finishToolStep)
  const threadMentions = useAgentStore((s) => s.threadMentions)
  const threadSkillIds = useAgentStore((s) => s.threadSkillIds)
  const setThreadSkillIds = useAgentStore((s) => s.setThreadSkillIds)
  const setPendingTurnSkillIds = useAgentStore((s) => s.setPendingTurnSkillIds)
  const setThreadMentions = useAgentStore((s) => s.setThreadMentions)
  const chatMode = useAgentStore((s) => s.chatMode)
  const setChatMode = useAgentStore((s) => s.setChatMode)
  const sessionPhase = useAgentStore((s) => s.sessionPhase)
  const pendingChoice = useAgentStore((s) => s.pendingChoice)
  const setPendingChoice = useAgentStore((s) => s.setPendingChoice)
  const clearSessionWait = useAgentStore((s) => s.clearSessionWait)
  const setSessionPhase = useAgentStore((s) => s.setSessionPhase)
  const setView = useAgentStore((s) => s.setView)

  const openThread = useCallback(
    async (id: string) => {
      setThreadId(id)
      clearSessionWait()
      setSessionPhase('idle')
      setThreadSkillIds([])
      pinToBottom()
      try {
        // 遗留写工具 pending：自动执行并清空，避免卡在「待确认」
        try {
          await api.drainAgentWritePending(id)
        } catch {
          /* ignore */
        }
        const [msgs, detail] = await Promise.all([
          api.listAgentMessages(id),
          api.getAgentThread(id),
        ])
        setLines(
          msgs.map((m) => ({
            id: nextAgentLineId(),
            role: (m.role === 'assistant'
              ? 'assistant'
              : m.role === 'system'
                ? 'system'
                : 'user') as AgentChatLine['role'],
            content: m.content ?? '',
            skillIds: Array.isArray(m.skillIds) ? m.skillIds.filter(Boolean) : undefined,
            images: Array.isArray(m.images)
              ? m.images
                  .map((img) => ({ mime: img.mime ?? '', data: img.data ?? '' }))
                  .filter((img) => img.data)
              : undefined,
            seq: typeof m.seq === 'number' && m.seq > 0 ? m.seq : undefined,
            tools: Array.isArray(m.tools)
              ? m.tools
                  .map((tool, i) => ({
                    id: String(tool.id || `${m.seq || 0}-tool-${i}`),
                    callId: tool.id ? String(tool.id) : undefined,
                    tool: String(tool.name || ''),
                    status: mapToolStatus(String(tool.status || '')),
                    argsPreview: tool.args ? String(tool.args) : undefined,
                    summary: tool.summary ? String(tool.summary) : undefined,
                  }))
                  .filter((tool) => tool.tool)
              : undefined,
          })),
        )
        const ctxSkills = detail?.context?.skillIds
        if (Array.isArray(ctxSkills) && ctxSkills.length > 0) {
          setThreadSkillIds(ctxSkills.filter(Boolean))
        } else {
          const lastUser = [...msgs]
            .reverse()
            .find((m) => m.role === 'user' && Array.isArray(m.skillIds) && m.skillIds.length)
          if (lastUser?.skillIds?.length) setThreadSkillIds(lastUser.skillIds.filter(Boolean))
        }
        setThreadMentions(parseMentionsFromEvent(detail?.context?.mentions))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
      setView('chat')
    },
    [
      setThreadId,
      clearSessionWait,
      setSessionPhase,
      setLines,
      setView,
      setStatusMessage,
      setThreadMentions,
      setThreadSkillIds,
      pinToBottom,
    ],
  )

  const threadBooted = useRef(false)
  useEffect(() => {
    if (collapsed || threadBooted.current) return
    const id = useAgentStore.getState().threadId
    if (!id || lines.length > 0) {
      threadBooted.current = true
      if (id && lines.length > 0) {
        void api.drainAgentWritePending(id).catch(() => {})
      }
      return
    }
    threadBooted.current = true
    void openThread(id)
  }, [collapsed, lines.length, openThread])

  useEffect(() => {
    const isActiveThread = (eventThreadId: string) =>
      !!eventThreadId && eventThreadId === useAgentStore.getState().threadId

    const adoptThread = (eventThreadId: string, mentions?: unknown) => {
      if (!eventThreadId) return
      const cur = useAgentStore.getState().threadId
      if (eventThreadId === cur) return
      setThreadId(eventThreadId)
      setLines([])
      clearSessionWait()
      setSessionPhase('streaming')
      pinToBottom()
      if (mentions !== undefined) {
        setThreadMentions(parseMentionsFromEvent(mentions))
      }
    }

    const unsub = subscribeAgentEvents({
      onUser: (evt) => {
        adoptThread(evt.threadId, evt.mentions)
        appendLine({
          id: nextAgentLineId(),
          role: 'user',
          content: evt.content === '（图片）' ? '' : evt.content,
          mentions: parseMentionsFromEvent(evt.mentions),
          skillIds: evt.skillIds,
          images: evt.images,
          seq: evt.seq,
        })
        if (evt.skillIds?.length) setThreadSkillIds(evt.skillIds)
      },
      onAssistantDelta: (tid, delta) => {
        if (!isActiveThread(tid)) return
        const { streamingLineId } = useAgentStore.getState()
        if (!streamingLineId) beginStreaming()
        appendStreamDelta(delta)
      },
      onAssistant: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        const { streamingLineId } = useAgentStore.getState()
        if (streamingLineId) {
          finishStreaming(evt.content, evt.seq)
        } else if (evt.content) {
          // 无 token delta：仍走流式揭示，避免整段闪现
          beginStreaming()
          useAgentStore.setState({ streamingDraft: evt.content })
          if (evt.skillIds?.length) setPendingTurnSkillIds(evt.skillIds)
          finishStreaming(evt.content, evt.seq)
        }
      },
      onToolStart: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        cancelStreaming()
        pushToolStep(evt.tool, storeArgs(evt.args), evt.callId)
      },
      onToolEnd: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        finishToolStep(
          { callId: evt.callId, tool: evt.tool },
          mapToolStatus(evt.status || 'ok'),
          evt.summary,
        )
      },
      onOfferChoices: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        finishToolStep(
          { callId: evt.pendingId, tool: 'offer_choices' },
          'need_choice',
          evt.summary,
        )
        setPendingChoice(evt)
      },
      onDone: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        cancelStreaming()
        for (const ln of useAgentStore.getState().lines) {
          for (const step of ln.tools || []) {
            if (step.status === 'running') {
              finishToolStep(
                { callId: step.callId, tool: step.tool },
                evt.error ? 'error' : 'ok',
                evt.error,
              )
            }
          }
        }
        if (evt.stopped) {
          appendLine({ id: nextAgentLineId(), role: 'system', content: t('agent.stopped') })
          clearSessionWait()
          setSessionPhase('idle')
        } else if (evt.error) {
          appendLine({ id: nextAgentLineId(), role: 'system', content: evt.error ?? '' })
          setStatusMessage(evt.error)
          setSessionPhase('error')
        } else if (!evt.waitingChoice) {
          setSessionPhase('idle')
        }
        if (!evt.waitingChoice) setPendingChoice(null)
      },
    })
    return unsub
  }, [
    t,
    setStatusMessage,
    setThreadId,
    setLines,
    setThreadMentions,
    appendLine,
    beginStreaming,
    appendStreamDelta,
    finishStreaming,
    cancelStreaming,
    pushToolStep,
    finishToolStep,
    pinToBottom,
    setPendingChoice,
    clearSessionWait,
    setSessionPhase,
    setThreadSkillIds,
    setPendingTurnSkillIds,
  ])

  const autoMentions = buildAutoMentions({
    activeProduct,
    surface: agentSurface,
    activeConnectionId,
    sessionConnectionId: session?.connectionId,
    connections: connections.map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      dbType: c.dbType,
    })),
  })

  const buildContext = (mentions: AgentMention[]) => {
    const pluginPackId = activeProduct === 'database' ? 'database' : ''
    return model.AgentContextDO.createFrom({
      activeProduct,
      sessionId: session?.sessionId ?? agentSurface.sessionId ?? '',
      connectionId: activeConnectionId ?? session?.connectionId ?? agentSurface.connectionId ?? '',
      database: agentSurface.database || session?.database || '',
      table: agentSurface.table || '',
      focusKind: agentSurface.focusKind || '',
      focusLabel: agentSurface.focusLabel || '',
      tabTitle: agentSurface.tabTitle || '',
      openTabsBrief: agentSurface.openTabsBrief || '',
      selectionBrief: agentSurface.selectionBrief || '',
      hostId: agentSurface.hostId || '',
      noteId: agentSurface.noteId || '',
      mentions: toContextMentions(mentions),
      ...(pluginPackId ? { pluginPackId } : {}),
    })
  }

  const active =
    sessionPhase === 'streaming' ||
    sessionPhase === 'tools' ||
    sessionPhase === 'needs_choice'

  const stopGeneration = async () => {
    const tid = useAgentStore.getState().threadId
    clearSessionWait()
    cancelStreaming()
    setSessionPhase('idle')
    if (!tid) return
    try {
      await api.agentStop(tid)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const send = async (
    text: string,
    mentions: AgentMention[],
    images: ChatImage[] = [],
    skillIds: string[] = [],
    modeOverride?: AgentChatMode,
  ) => {
    const phase = useAgentStore.getState().sessionPhase
    if (
      (!text.trim() && images.length === 0) ||
      phase === 'streaming' ||
      phase === 'tools' ||
      phase === 'needs_choice'
    ) {
      return
    }
    const allSkillIds = mergeSkillIds(threadSkillIds, skillIds)
    const mode = modeOverride ?? chatMode
    if (modeOverride && modeOverride !== chatMode) setChatMode(modeOverride)
    clearSessionWait()
    setSessionPhase('streaming')
    setPendingTurnSkillIds(allSkillIds)
    if (allSkillIds.length > 0) setThreadSkillIds(allSkillIds)
    pinToBottom()
    try {
      const ephemeralAuto = filterEphemeralAutoMentions(autoMentions, mentions)
      const contextMentions = mergeMentions(mentions, ephemeralAuto)
      const res = await api.agentChat(
        model.AgentChatRequestDO.createFrom({
          threadId: useAgentStore.getState().threadId,
          message: text.trim(),
          images: images.map((img) => ({ mime: img.mime, data: img.data })),
          mode,
          skillIds: allSkillIds.length ? allSkillIds : undefined,
          context: buildContext(contextMentions),
        }),
      )
      if (res.threadId) setThreadId(res.threadId)
      setThreadMentions(mentions)
    } catch (e) {
      setSessionPhase('error')
      const msg = (e as Error).message || t('agent.sendFailed')
      appendLine({ id: nextAgentLineId(), role: 'system', content: msg })
      setStatusMessage(msg)
      if (/API Key|模型名称|AI 设置|api key|model/i.test(msg)) {
        setView('config')
      }
      throw e
    }
  }

  const submitChoice = async (answers: ChoiceSubmitAnswer[]) => {
    const withPending = answers.filter((a) => a.pendingId)
    if (withPending.length > 0) {
      const pending = useAgentStore.getState().pendingChoice
      if (!pending) return
      const payload = withPending.map(
        (a) =>
          ({
            pendingId: a.pendingId!,
            keys: a.keys,
            text: a.text,
          }) satisfies model.AgentChoiceAnswerDO,
      )
      setPendingChoice(null)
      setSessionPhase('streaming')
      const switchKeys = new Set(['go_agent', 'switch_agent', 'agent', 'granttools'])
      const wantsAgent = payload.some((a) => a.keys.some((k) => switchKeys.has(String(k).toLowerCase())))
      const modeForResume = wantsAgent ? 'agent' : chatMode
      if (wantsAgent) {
        setChatMode('agent')
        setStatusMessage(t('agent.switchedToAgentForPlugin'))
      }
      try {
        const tid = useAgentStore.getState().threadId
        if (tid) await api.setAgentThreadMode(tid, modeForResume)
        await api.agentChoose(payload)
      } catch (e) {
        setSessionPhase('error')
        setStatusMessage((e as Error).message)
      }
      return
    }

    // 围栏 agent-choice：无 pendingId，转成用户消息发送
    const questions: AgentChoiceQuestion[] = answers.map((a, i) => ({
      n: i + 1,
      id: a.pendingId,
      mode: a.text && !a.keys.length ? 'text' : a.keys.length > 1 ? 'multi' : 'single',
      prompt: '',
      options: a.keys.map((k) => ({ key: k, label: k })),
    }))
    const byN: Record<number, { keys: string[]; text: string }> = {}
    answers.forEach((a, i) => {
      byN[i + 1] = { keys: a.keys, text: a.text }
    })
    // 优先用选项 label：从最后一条助手消息的 choice 面板文案已在 keys 路径；这里用 text 或 key
    const texts = answers
      .map((a) => a.text.trim() || a.keys.join('、'))
      .filter(Boolean)
    const body = texts.join('\n') || joinChoiceSendTexts(questions, byN)
    if (!body.trim()) return
    await send(body, mergeMentions(threadMentions, autoMentions))
  }

  const handleModeChange = (mode: AgentChatMode) => {
    setChatMode(mode)
    const tid = useAgentStore.getState().threadId
    if (tid) {
      void api.setAgentThreadMode(tid, mode).catch((e) => setStatusMessage((e as Error).message))
    }
  }

  const newThread = () => {
    resetThread()
  }

  const unbindThreadMention = async (id: string, kind: AgentMention['kind']) => {
    const next = threadMentions.filter((m) => !(m.id === id && m.kind === kind))
    setThreadMentions(next)
    if (!threadId) return
    try {
      await api.setAgentThreadBindings(threadId, next)
    } catch (e) {
      setThreadMentions(threadMentions)
      setStatusMessage((e as Error).message)
    }
  }

  const unbindThreadSkill = (id: string) => {
    const next = threadSkillIds.filter((s) => s !== id)
    setThreadSkillIds(next)
    if (!threadId) return
    void api.setAgentThreadSkillIds(threadId, next).catch((e) => setStatusMessage((e as Error).message))
  }

  const offerChoiceQuestions = (evt: AgentOfferChoicesEvent | null) => {
    if (!evt?.items.length) return undefined
    return evt.items.map((it) => ({
      n: it.n,
      id: it.pendingId,
      mode: it.mode,
      prompt: it.prompt || it.summary || '',
      options: (it.options || []).map((o) => ({ key: o.key, label: o.label })),
      placeholder: it.placeholder,
    }))
  }

  return {
    threadId,
    lines,
    chatMode,
    sessionPhase,
    active,
    pendingChoice,
    choiceQuestions: offerChoiceQuestions(pendingChoice),
    threadMentions,
    threadSkillIds,
    autoMentions,
    openThread,
    newThread,
    send,
    stopGeneration,
    submitChoice,
    handleModeChange,
    unbindThreadMention,
    unbindThreadSkill,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { askConfirm } from '../../utils/askConfirm'
import { subscribeAgentEvents } from '../../api/agentEvents'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { nextAgentLineId, useAgentStore, type AgentChatLine } from '../../stores/agentStore'
import { model } from '../../../wailsjs/go/models'
import type { AgentConfirmEvent } from '../../api/agentEvents'
import type { AgentPanelView, CapabilityRow } from './agentTypes'
import { AgentConfigView, saveAgentAPIConfig } from './AgentConfigView'
import { rememberRecentModel } from './agentChatMode'
import { AgentPermissionsView, saveAgentPermissions } from './AgentPermissionsView'
import { useAgentPanelResize } from './useAgentPanelResize'
import { ResizeHandle } from '../../components/layout'
import { useAgentChatScroll } from './useAgentChatScroll'
import { subscribeCommandResults } from './agentUiActions'
import { AgentChatPane } from './AgentChatPane'
import { AgentThreadHistory } from './AgentThreadHistory'
import {
  buildAutoMentions,
  filterEphemeralAutoMentions,
  mergeMentions,
  parseMentionsFromEvent,
  toContextMentions,
  type AgentMention,
} from './agentMention'
import { saveReplyToNotebook, savedToNotebookMessage } from './saveReplyToNotebook'
import { buildSkillLabelMap, mergeSkillIds } from './agentSkillIds'

interface AgentThreadItem {
  id: string
  title: string
  updatedAt: number
}

/** AgentPanel 全局 AI Copilot 侧栏（收起保留对话，Tab 切换设置）。 */
export function AgentPanel({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n()
  const {
    activeProduct,
    session,
    activeConnectionId,
    connections,
    agentSurface,
    setStatusMessage,
  } = useAppStore()
  const view = useAgentStore((s) => s.view)
  const setView = useAgentStore((s) => s.setView)
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
  const toolSteps = useAgentStore((s) => s.toolSteps)
  const pushToolStep = useAgentStore((s) => s.pushToolStep)
  const finishToolStep = useAgentStore((s) => s.finishToolStep)
  const clearToolSteps = useAgentStore((s) => s.clearToolSteps)
  const threadMentions = useAgentStore((s) => s.threadMentions)
  const threadSkillIds = useAgentStore((s) => s.threadSkillIds)
  const setThreadSkillIds = useAgentStore((s) => s.setThreadSkillIds)
  const setPendingTurnSkillIds = useAgentStore((s) => s.setPendingTurnSkillIds)
  const setThreadMentions = useAgentStore((s) => s.setThreadMentions)
  const chatMode = useAgentStore((s) => s.chatMode)
  const setChatMode = useAgentStore((s) => s.setChatMode)

  const [showHistory, setShowHistory] = useState(false)
  const [threads, setThreads] = useState<AgentThreadItem[]>([])

  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<AgentConfirmEvent | null>(null)
  const [skillCatalog, setSkillCatalog] = useState<Record<string, string>>({})

  const [apiBase, setApiBase] = useState('https://dashscope.aliyuncs.com/compatible-mode/v1')
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('qwen-plus')
  const [hasKey, setHasKey] = useState(false)
  const [allowWrite, setAllowWrite] = useState(false)
  const [provider, setProvider] = useState('bailian')
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([])
  const [unavailableNote, setUnavailableNote] = useState('')

  const [configError, setConfigError] = useState('')
  const [permError, setPermError] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [savingPerm, setSavingPerm] = useState(false)
  const [testing, setTesting] = useState(false)
  const { width, onResizeStart } = useAgentPanelResize()

  const scrollContentKey = [
    lines.map((l) => `${l.id}:${l.content.length}`).join('|'),
    toolSteps.map((s) => `${s.id}:${s.status}`).join('|'),
    pending?.pendingId ?? '',
    busy ? '1' : '0',
  ].join('#')
  const { scrollRef, onScroll: onMessagesScroll, pinToBottom } = useAgentChatScroll(
    view === 'chat' && !collapsed && !showHistory,
    scrollContentKey,
  )

  const switchView = (next: AgentPanelView) => {
    if (next === 'config') setConfigError('')
    if (next === 'permissions') setPermError('')
    setView(next)
  }

  const loadSettings = useCallback(async () => {
    const s = await api.getAgentSettings()
    setApiBase(s.apiBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    setModelName(s.model || 'qwen-plus')
    if (s.model) rememberRecentModel(s.model)
    setHasKey(s.hasApiKey)
    setAllowWrite(s.allowWrite)
    setProvider(s.provider || 'bailian')
    setUnavailableNote(s.unavailableNote || '')
    const caps = s.capabilities ?? []
    if (caps.length > 0) {
      setCapabilities(
        caps.map((c) => ({
          name: c.name,
          label: c.label,
          risk: c.risk,
          description: c.description,
          enabled: c.enabled,
          needsConfirm: c.needsConfirm,
        })),
      )
    } else {
      const list = await api.listAgentCapabilities()
      setCapabilities(
        list.map((c) => ({
          name: c.name,
          label: c.label,
          risk: c.risk,
          description: c.description,
          enabled: c.enabled,
          needsConfirm: c.needsConfirm,
        })),
      )
    }
  }, [])

  useEffect(() => {
    void loadSettings().catch((e) => setConfigError((e as Error).message))
    void api.listEnabledAgentSkills().then((list) => {
      setSkillCatalog(buildSkillLabelMap(list))
    })
  }, [loadSettings])

  const loadThreadList = useCallback(async () => {
    try {
      const list = await api.listAgentThreads()
      setThreads(
        list.map((th) => ({
          id: th.id,
          title: th.title || t('agent.untitledThread'),
          updatedAt: th.updatedAt ?? 0,
        })),
      )
    } catch {
      setThreads([])
    }
  }, [t])

  const openThread = useCallback(
    async (id: string) => {
      setThreadId(id)
      setPending(null)
      setBusy(false)
      setThreadSkillIds([])
      pinToBottom()
      try {
        const [msgs, detail] = await Promise.all([
          api.listAgentMessages(id),
          api.getAgentThread(id),
        ])
        setLines(
          msgs.map((m) => ({
            id: nextAgentLineId(),
            role: (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user') as AgentChatLine['role'],
            content: m.content ?? '',
            skillIds: Array.isArray(m.skillIds) ? m.skillIds.filter(Boolean) : undefined,
            images: Array.isArray(m.images)
              ? m.images.map((img) => ({ mime: img.mime ?? '', data: img.data ?? '' })).filter((img) => img.data)
              : undefined,
            seq: typeof m.seq === 'number' && m.seq > 0 ? m.seq : undefined,
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
      setShowHistory(false)
      setView('chat')
    },
    [setThreadId, setLines, setView, setStatusMessage, setThreadMentions, setThreadSkillIds, pinToBottom],
  )

  const threadBooted = useRef(false)
  useEffect(() => {
    if (collapsed || threadBooted.current) return
    const id = useAgentStore.getState().threadId
    if (!id || lines.length > 0) {
      threadBooted.current = true
      return
    }
    threadBooted.current = true
    void openThread(id)
  }, [collapsed, lines.length, openThread])

  useEffect(() => {
    if (view === 'chat' && showHistory) void loadThreadList()
  }, [view, showHistory, loadThreadList])

  useEffect(() => {
    const unsub = subscribeCommandResults((raw) => {
      if (!raw.ok && raw.error) setStatusMessage(String(raw.error))
    })
    return unsub
  }, [setStatusMessage])

  useEffect(() => {
    const isActiveThread = (eventThreadId: string) =>
      !!eventThreadId && eventThreadId === useAgentStore.getState().threadId

    const adoptThread = (eventThreadId: string, mentions?: unknown) => {
      if (!eventThreadId) return
      const cur = useAgentStore.getState().threadId
      if (eventThreadId === cur) return
      setThreadId(eventThreadId)
      setLines([])
      clearToolSteps()
      setPending(null)
      setBusy(true)
      pinToBottom()
      if (mentions !== undefined) {
        setThreadMentions(parseMentionsFromEvent(mentions))
      }
    }

    const unsub = subscribeAgentEvents({
      onUser: (evt) => {
        adoptThread(evt.threadId, evt.mentions)
        clearToolSteps()
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
          appendLine({
            id: nextAgentLineId(),
            role: 'assistant',
            content: evt.content,
            skillIds: evt.skillIds,
            seq: evt.seq,
          })
        }
      },
      onToolStart: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        cancelStreaming()
        const args = evt.args?.trim()
        pushToolStep(evt.tool, args && args.length > 96 ? `${args.slice(0, 93)}…` : args)
      },
      onToolEnd: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        const st = (evt.status || 'ok') as 'ok' | 'error' | 'denied' | 'need_confirm'
        finishToolStep(evt.tool, st, evt.summary)
      },
      onNeedsConfirm: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        finishToolStep(evt.tool, 'need_confirm', evt.summary)
        setPending(evt)
        setBusy(false)
      },
      onDone: (evt) => {
        if (!isActiveThread(evt.threadId)) return
        setBusy(false)
        cancelStreaming()
        for (const step of useAgentStore.getState().toolSteps) {
          if (step.status === 'running') finishToolStep(step.tool, evt.error ? 'error' : 'ok', evt.error)
        }
        if (evt.stopped) {
          appendLine({ id: nextAgentLineId(), role: 'system', content: t('agent.stopped') })
        } else if (evt.error) {
          appendLine({ id: nextAgentLineId(), role: 'system', content: evt.error ?? '' })
          setStatusMessage(evt.error)
        }
        if (!evt.waitingConfirm) setPending(null)
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
    clearToolSteps,
    pushToolStep,
    finishToolStep,
    pinToBottom,
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
      noteId: agentSurface.noteId || '',
      mentions: toContextMentions(mentions),
    })
  }

  const stopGeneration = async () => {
    if (!threadId) return
    try {
      await api.agentStop(threadId)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
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

  const toggleCapability = (name: string) => {
    setCapabilities((prev) => prev.map((c) => (c.name === name ? { ...c, enabled: !c.enabled } : c)))
  }

  const unbindThreadSkill = (id: string) => {
    const next = threadSkillIds.filter((s) => s !== id)
    setThreadSkillIds(next)
    if (!threadId) return
    void api.setAgentThreadSkillIds(threadId, next).catch((e) => setStatusMessage((e as Error).message))
  }

  const send = async (
    text: string,
    mentions: AgentMention[],
    images: { mime: string; data: string }[] = [],
    skillIds: string[] = [],
  ) => {
    if ((!text.trim() && images.length === 0) || busy) return
    const allSkillIds = mergeSkillIds(threadSkillIds, skillIds)
    clearToolSteps()
    setBusy(true)
    setPending(null)
    setPendingTurnSkillIds(allSkillIds)
    if (allSkillIds.length > 0) setThreadSkillIds(allSkillIds)
    pinToBottom()
    try {
      const ephemeralAuto = filterEphemeralAutoMentions(autoMentions, mentions)
      const contextMentions = mergeMentions(mentions, ephemeralAuto)
      const res = await api.agentChat(
        model.AgentChatRequestDO.createFrom({
          threadId,
          message: text.trim(),
          images: images.map((img) => ({ mime: img.mime, data: img.data })),
          mode: chatMode,
          skillIds: allSkillIds.length ? allSkillIds : undefined,
          context: buildContext(contextMentions),
        }),
      )
      if (res.threadId) setThreadId(res.threadId)
      setThreadMentions(mentions)
    } catch (e) {
      setBusy(false)
      const msg = (e as Error).message || t('agent.sendFailed')
      appendLine({ id: nextAgentLineId(), role: 'system', content: msg })
      setStatusMessage(msg)
      if (/API Key|模型名称|AI 设置|api key|model/i.test(msg)) {
        setConfigError(msg)
        setView('config')
      }
      throw e
    }
  }

  const rewindTo = async (keepSeq: number) => {
    if (!threadId || busy || keepSeq <= 0) return
    const ok = await askConfirm({
      title: t('agent.rewindTitle'),
      message: t('agent.rewindConfirm'),
      confirmLabel: t('agent.rewindHere'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.agentRewind(threadId, keepSeq)
      clearToolSteps()
      setPending(null)
      setLines((prev) => prev.filter((ln) => !ln.seq || ln.seq <= keepSeq))
      setStatusMessage(t('agent.rewindDone'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmPending = async (approved: boolean) => {
    if (!pending) return
    const id = pending.pendingId
    setPending(null)
    setBusy(true)
    try {
      await api.agentConfirm(id, approved)
    } catch (e) {
      setBusy(false)
      setStatusMessage((e as Error).message)
    }
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    setConfigError('')
    try {
      await saveAgentAPIConfig(apiBase, apiKey, modelName, provider)
      setApiKey('')
      await loadSettings()
      setStatusMessage(t('agent.configSaved'))
      setView('chat')
    } catch (e) {
      const msg = (e as Error).message
      setConfigError(msg)
      setStatusMessage(msg)
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSavePermissions = async () => {
    setSavingPerm(true)
    setPermError('')
    try {
      await saveAgentPermissions(allowWrite, capabilities)
      await loadSettings()
      setStatusMessage(t('agent.permissionsSaved'))
      setView('chat')
    } catch (e) {
      const msg = (e as Error).message
      setPermError(msg)
      setStatusMessage(msg)
    } finally {
      setSavingPerm(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setConfigError('')
    try {
      if (!hasKey && !apiKey.trim()) {
        throw new Error(t('agent.needApiKey'))
      }
      if (!hasKey && apiKey.trim()) {
        await saveAgentAPIConfig(apiBase, apiKey, modelName, provider)
        setApiKey('')
        await loadSettings()
      }
      const msg = await api.testAgentConnection()
      setStatusMessage(msg)
    } catch (e) {
      const msg = (e as Error).message
      setConfigError(msg)
      setStatusMessage(msg)
    } finally {
      setTesting(false)
    }
  }

  const applyPreset = async (id: 'bailian' | 'deepseek' | 'minimax') => {
    try {
      const s = await api.applyAgentProviderPreset(id)
      setApiBase(s.apiBase)
      setModelName(s.model)
      setProvider(s.provider || id)
      const msgKey =
        id === 'deepseek'
          ? 'agent.deepseekPresetApplied'
          : id === 'minimax'
            ? 'agent.minimaxPresetApplied'
            : 'agent.bailianPresetApplied'
      setStatusMessage(t(msgKey))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const newThread = () => {
    resetThread()
    setPending(null)
    setBusy(false)
  }

  const switchModel = async (id: string) => {
    const next = id.trim()
    if (!next || next === modelName) return
    try {
      await saveAgentAPIConfig(apiBase, '', next, provider)
      setModelName(next)
      rememberRecentModel(next)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const tabs: { id: AgentPanelView; label: string }[] = [
    { id: 'chat', label: t('agent.tabChat') },
    { id: 'config', label: t('agent.tabSettings') },
    { id: 'permissions', label: t('agent.tabPermissions') },
  ]

  return (
    <aside
      className={`agent-panel${collapsed ? ' agent-panel-collapsed' : ''}`}
      style={{ width: collapsed ? undefined : width }}
      aria-hidden={collapsed}
      aria-label={t('agent.title')}
    >
      <ResizeHandle axis="x" onMouseDown={onResizeStart} title={t('agent.resize')} className="agent-panel-resize" />
      <header className="agent-panel-head">
        <span className="agent-panel-title">{t('agent.title')}</span>
        <div className="agent-panel-actions">
          {view === 'chat' && (
            <>
              <button
                type="button"
                className={`wn-btn wn-btn-xs wn-btn-ghost${showHistory ? ' active' : ''}`}
                onClick={() => setShowHistory((v) => !v)}
              >
                {t('agent.history')}
              </button>
              <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" onClick={newThread} title={t('agent.newThread')}>
                {t('agent.newThread')}
              </button>
            </>
          )}
        </div>
      </header>

      <nav className="agent-panel-tabs" role="tablist" aria-label={t('agent.title')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            className={`agent-panel-tab${view === tab.id ? ' is-active' : ''}`}
            onClick={() => switchView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {view === 'config' && (
        <AgentConfigView
          apiBase={apiBase}
          setApiBase={setApiBase}
          apiKey={apiKey}
          setApiKey={setApiKey}
          modelName={modelName}
          setModelName={setModelName}
          hasKey={hasKey}
          provider={provider}
          error={configError}
          saving={savingConfig}
          testing={testing}
          onApplyPreset={(id) => void applyPreset(id)}
          onTest={() => void testConnection()}
          onSave={() => void handleSaveConfig()}
        />
      )}

      {view === 'permissions' && (
        <AgentPermissionsView
          capabilities={capabilities}
          unavailableNote={unavailableNote}
          allowWrite={allowWrite}
          setAllowWrite={setAllowWrite}
          onToggle={toggleCapability}
          error={permError}
          saving={savingPerm}
          onSave={() => void handleSavePermissions()}
        />
      )}

      {view === 'chat' && showHistory && (
        <AgentThreadHistory
          threads={threads}
          activeThreadId={threadId}
          emptyHint={t('agent.noHistory')}
          onOpen={(id) => void openThread(id)}
        />
      )}

      {view === 'chat' && !showHistory && (
        <AgentChatPane
          t={t}
          lines={lines}
          busy={busy}
          chatMode={chatMode}
          toolSteps={toolSteps}
          skillCatalog={skillCatalog}
          threadMentions={threadMentions}
          threadSkillIds={threadSkillIds}
          autoMentions={autoMentions}
          pending={pending}
          threadId={threadId}
          modelName={modelName}
          provider={provider}
          scrollRef={scrollRef}
          onMessagesScroll={onMessagesScroll}
          onChoiceDraft={(text) => {
            useAgentStore.getState().applyDraft({
              message: text,
              mentions: threadMentions,
              skillIds: threadSkillIds,
            })
          }}
          onSaveToNotebook={(content) => {
            void saveReplyToNotebook(content, mergeMentions(threadMentions, autoMentions))
              .then(() => setStatusMessage(t(`agent.${savedToNotebookMessage()}`)))
              .catch((e) => setStatusMessage((e as Error).message))
          }}
          onRewind={(seq) => void rewindTo(seq)}
          onConfirm={(ok) => void confirmPending(ok)}
          onModeChange={setChatMode}
          onModelChange={(id) => void switchModel(id)}
          onSend={(text, mentions, images, skillIds) => send(text, mentions, images, skillIds ?? [])}
          onStop={() => void stopGeneration()}
          onUnbindThreadMention={(id, kind) => void unbindThreadMention(id, kind)}
          onUnbindThreadSkill={unbindThreadSkill}
        />
      )}
    </aside>
  )
}

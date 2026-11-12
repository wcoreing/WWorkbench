import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { useLoading, withLoading } from '../../stores/loadingStore'
import { useAgentStore } from '../../stores/agentStore'
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
import { mergeMentions } from './agentMention'
import { buildSkillLabelMap } from './agentSkillIds'
import { useAgentSession } from './useAgentSession'
import { pressProps } from '../../components/compat'
import { bindAssetsToAgent, readAssetDrag, transferHasAssetDrag } from './agentAssetDrag'
import { mentionNote } from './openAgentDraft'
import { readNotebookDrag, transferHasNotebookDrag } from '../notebook/notebookTree'
import { notify } from '../../notify'

interface AgentThreadItem {
  id: string
  title: string
  updatedAt: number
}

/** AgentPanel 全局 AI Copilot 侧栏（收起保留对话，Tab 切换设置）。 */
export function AgentPanel({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const view = useAgentStore((s) => s.view)
  const setView = useAgentStore((s) => s.setView)
  const lines = useAgentStore((s) => s.lines)
  const streamingDraft = useAgentStore((s) => s.streamingDraft)
  const revealingLineId = useAgentStore((s) => s.revealingLineId)
  const sessionPhase = useAgentStore((s) => s.sessionPhase)
  const pendingChoice = useAgentStore((s) => s.pendingChoice)

  const [showHistory, setShowHistory] = useState(false)
  const [threads, setThreads] = useState<AgentThreadItem[]>([])
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
  const testLoading = useLoading('agent.testConnection')
  const { width, onResizeStart } = useAgentPanelResize()

  // 滚动 key：草稿按块节流，避免每 token 同步贴底打满主线程（增高靠 ResizeObserver）
  const scrollContentKey = [
    lines
      .map(
        (l) =>
          `${l.id}:${l.content.length}:${l.contentAfter?.length ?? 0}:${(l.tools || []).length}:${(l.tools || [])
            .map((tool) => tool.status)
            .join(',')}`,
      )
      .join('|'),
    Math.floor(streamingDraft.length / 48),
    pendingChoice?.pendingId ?? '',
    sessionPhase,
  ].join('#')

  const forceStick =
    sessionPhase === 'streaming' ||
    sessionPhase === 'tools' ||
    Boolean(revealingLineId) ||
    streamingDraft.length > 0

  const { scrollRef, endRef, onScroll: onMessagesScroll, pinToBottom } = useAgentChatScroll(
    view === 'chat' && !collapsed,
    scrollContentKey,
    forceStick,
  )

  const session = useAgentSession({ collapsed, pinToBottom })

  const runningToolCount = useAgentStore((s) => {
    let n = 0
    for (const ln of s.lines) {
      for (const step of ln.tools || []) {
        if (step.status === 'running') n += 1
      }
    }
    return n
  })

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

  useEffect(() => {
    if (view === 'chat' && showHistory) void loadThreadList()
  }, [view, showHistory, loadThreadList])

  useEffect(() => {
    const unsub = subscribeCommandResults((raw) => {
      if (!raw.ok && raw.error) setStatusMessage(String(raw.error))
    })
    return unsub
  }, [setStatusMessage])

  const toggleCapability = (name: string) => {
    setCapabilities((prev) => prev.map((c) => (c.name === name ? { ...c, enabled: !c.enabled } : c)))
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
    await withLoading(
      'agent.testConnection',
      async () => {
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
        }
      },
      { label: t('agent.testing') },
    )
  }

  const applyPreset = async (id: 'bailian' | 'deepseek' | 'minimax' | 'cursor') => {
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
            : id === 'cursor'
              ? 'agent.cursorPresetApplied'
              : 'agent.bailianPresetApplied'
      setStatusMessage(t(msgKey))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
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

  const onPanelDragOver = (e: DragEvent) => {
    if (!transferHasAssetDrag(e.dataTransfer) && !transferHasNotebookDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onPanelDrop = (e: DragEvent) => {
    let assets = readAssetDrag(e.dataTransfer)
    if (!assets.length) {
      const notebook = readNotebookDrag(e.dataTransfer)
      if (notebook?.kind === 'note' && notebook.id) {
        assets = [mentionNote({ id: notebook.id, title: notebook.title })]
      }
    }
    if (!assets.length) return
    e.preventDefault()
    e.stopPropagation()
    bindAssetsToAgent(assets)
    if (assets.length === 1) {
      notify.info(t('agent.assetDropped', { title: assets[0].label }))
    } else {
      notify.info(t('agent.assetsDropped', { count: assets.length }))
    }
  }

  return (
    <aside
      className={`agent-panel${collapsed ? ' agent-panel-collapsed' : ''}`}
      style={{ width: collapsed ? undefined : width }}
      aria-hidden={collapsed}
      aria-label={t('agent.title')}
      onDragOver={onPanelDragOver}
      onDrop={onPanelDrop}
    >
      <ResizeHandle axis="x" onMouseDown={onResizeStart} title={t('agent.resize')} />
      <div className="agent-panel-body">
        <header className="agent-panel-head">
          <span className="agent-panel-title">{t('agent.title')}</span>
          <div className="agent-panel-actions">
            {view === 'chat' && (
              <>
                <button
                  type="button"
                  className={`wn-btn wn-btn-xs wn-btn-ghost${showHistory ? ' active' : ''}`}
                  {...pressProps(() => setShowHistory((v) => !v))}
                >
                  {t('agent.history')}
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-xs wn-btn-ghost"
                  {...pressProps(session.newThread)}
                  title={t('agent.newThread')}
                >
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
              {...pressProps(() => switchView(tab.id))}
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
            testing={testLoading.active}
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

        {view === 'chat' && (
          <div className="agent-chat-stage">
            <AgentChatPane
              t={t}
              lines={session.lines}
              sessionPhase={session.sessionPhase}
              active={session.active}
              runningToolCount={runningToolCount}
              chatMode={session.chatMode}
              skillCatalog={skillCatalog}
              threadMentions={session.threadMentions}
              threadSkillIds={session.threadSkillIds}
              autoMentions={session.autoMentions}
              choiceQuestions={session.choiceQuestions}
              threadId={session.threadId}
              modelName={modelName}
              provider={provider}
              scrollRef={scrollRef}
              endRef={endRef}
              onMessagesScroll={onMessagesScroll}
              onChoiceSubmit={(answers) => void session.submitChoice(answers)}
              onModeChange={session.handleModeChange}
              onModelChange={(id) => void switchModel(id)}
              onSend={(text, mentions, images, skillIds, mode) =>
                session.send(text, mentions, images, skillIds ?? [], mode)
              }
              onStop={() => void session.stopGeneration()}
              onUnbindThreadMention={(id, kind) => void session.unbindThreadMention(id, kind)}
              onUnbindThreadSkill={session.unbindThreadSkill}
              onSuggest={(item) => {
                if (item.goTerminal) {
                  useAppStore.getState().setActiveProduct('terminal')
                  return
                }
                void session.send(
                  item.message,
                  mergeMentions(session.threadMentions, session.autoMentions),
                  [],
                  [],
                  item.mode,
                )
              }}
            />
            {showHistory && (
              <div className="agent-history-drawer" role="dialog" aria-label={t('agent.history')}>
                <div className="agent-history-drawer-head">
                  <span>{t('agent.history')}</span>
                  <button
                    type="button"
                    className="wn-btn wn-btn-xs wn-btn-ghost"
                    {...pressProps(() => setShowHistory(false))}
                  >
                    {t('agent.closeHistory')}
                  </button>
                </div>
                <AgentThreadHistory
                  threads={threads}
                  activeThreadId={session.threadId}
                  emptyHint={t('agent.noHistory')}
                  onOpen={(id) => {
                    setShowHistory(false)
                    void session.openThread(id)
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

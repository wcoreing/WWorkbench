import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'
import { pressProps } from '../../components/compat'
import { loadSavedModels } from './agentChatMode'

export type AgentProviderPresetId = 'bailian' | 'deepseek' | 'minimax' | 'cursor'
export type AgentProviderId = AgentProviderPresetId | string

export interface AgentConfigViewProps {
  apiBase: string
  setApiBase: (v: string) => void
  apiKey: string
  setApiKey: (v: string) => void
  modelName: string
  setModelName: (v: string) => void
  hasKey: boolean
  provider: AgentProviderId
  error: string
  saving: boolean
  testing: boolean
  onApplyPreset: (provider: AgentProviderPresetId) => void
  onTest: () => void
  onSave: () => void
}

const PRESETS: { id: AgentProviderPresetId; labelKey: string }[] = [
  { id: 'bailian', labelKey: 'agent.bailianPreset' },
  { id: 'deepseek', labelKey: 'agent.deepseekPreset' },
  { id: 'minimax', labelKey: 'agent.minimaxPreset' },
  { id: 'cursor', labelKey: 'agent.cursorPreset' },
]

type SettingsPane = AgentProviderPresetId | 'mcp'

function isPreset(id: string): id is AgentProviderPresetId {
  return PRESETS.some((p) => p.id === id)
}

function modelPlaceholder(provider: string): string {
  switch (provider) {
    case 'deepseek':
      return 'deepseek-flash'
    case 'minimax':
      return 'MiniMax-M2.5'
    case 'bailian':
      return 'qwen-plus'
    case 'cursor':
      return 'composer-2.5'
    default:
      return 'model-id'
  }
}

async function copyText(text: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* ignore */
  }
}

export function AgentConfigView({
  apiBase,
  setApiBase,
  apiKey,
  setApiKey,
  modelName,
  setModelName,
  hasKey,
  provider,
  error,
  saving,
  testing,
  onApplyPreset,
  onTest,
  onSave,
}: AgentConfigViewProps) {
  const { t } = useI18n()
  const [showMcp, setShowMcp] = useState(false)
  const [mcpStatus, setMcpStatus] = useState<model.MCPStatusDO | null>(null)
  const [mcpError, setMcpError] = useState('')
  const [copied, setCopied] = useState(false)
  const [stageBusy, setStageBusy] = useState(false)
  const [stageMsg, setStageMsg] = useState('')
  const [trustOps, setTrustOps] = useState<
    Array<{
      tool: string
      hostKey: string
      fingerprint: string
      intent?: string
      command?: string
      risk?: string
      summary?: string
      at: number
    }>
  >([])
  const [trustBusy, setTrustBusy] = useState(false)
  const pane: SettingsPane | '' = showMcp ? 'mcp' : isPreset(provider) ? provider : ''
  const savedModels = loadSavedModels(provider)

  const refreshMCP = useCallback(async () => {
    const st = await api.getMCPStatus()
    setMcpStatus(st)
    setMcpError(st.error || '')
  }, [])

  const refreshTrustOps = useCallback(async () => {
    const list = await api.listMCPTrustOps()
    setTrustOps(list)
  }, [])

  useEffect(() => {
    void refreshMCP().catch((e) => setMcpError((e as Error).message))
  }, [refreshMCP])

  useEffect(() => {
    if (pane !== 'mcp') return
    void refreshTrustOps().catch(() => setTrustOps([]))
  }, [pane, refreshTrustOps])

  const onCopySnippet = async () => {
    await copyText(mcpStatus?.cursorSnippet || '')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const onEnsureStageRules = async () => {
    setStageBusy(true)
    setStageMsg('')
    try {
      const out = await api.ensureCursorStageRules()
      setStageMsg(
        t('agent.mcpStageRuleDone', {
          nOk: out.nOk ?? 0,
          nSkip: out.nSkip ?? 0,
          nErr: out.nErr ?? 0,
        }),
      )
    } catch (e) {
      setStageMsg((e as Error).message)
    } finally {
      setStageBusy(false)
    }
  }

  const onEnsureUserProjectStageRule = async () => {
    setStageBusy(true)
    setStageMsg('')
    try {
      const out = await api.ensureCursorUserProjectStageRule()
      setStageMsg(t('agent.mcpUserProjectStageRuleDone', { path: out.path || '' }))
    } catch (e) {
      setStageMsg((e as Error).message)
    } finally {
      setStageBusy(false)
    }
  }

  const onRemoveUserProjectStageRule = async () => {
    setStageBusy(true)
    setStageMsg('')
    try {
      await api.removeCursorUserProjectStageRule()
      setStageMsg(t('agent.mcpUserProjectStageRuleRemoved'))
    } catch (e) {
      setStageMsg((e as Error).message)
    } finally {
      setStageBusy(false)
    }
  }

  const busy = testing || saving
  const snippet = mcpStatus?.cursorSnippet || ''
  const mcpListening = Boolean(mcpStatus?.enabled && mcpStatus?.listenAddr)

  return (
    <div className="agent-subview agent-config-view">
      <div className="agent-config-split">
        <div className="agent-provider-nav" role="tablist" aria-orientation="vertical">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pane === p.id}
              className={`agent-provider-item${pane === p.id ? ' is-active' : ''}`}
              {...pressProps(() => {
                setShowMcp(false)
                if (provider !== p.id) onApplyPreset(p.id)
              })}
            >
              {t(p.labelKey)}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'mcp'}
            className={`agent-provider-item agent-provider-item-mcp${pane === 'mcp' ? ' is-active' : ''}`}
            {...pressProps(() => setShowMcp(true))}
          >
            MCP
          </button>
        </div>

        {pane === 'mcp' ? (
          <div className="agent-config-main" role="tabpanel">
            {mcpError && <p className="agent-settings-error">{mcpError}</p>}
            <div className="agent-field">
              <span className="wn-label">{t('agent.mcpHealth')}</span>
              <p className="agent-settings-hint">
                {mcpListening
                  ? t('agent.mcpHealthOn', { addr: mcpStatus?.listenAddr || '' })
                  : t('agent.mcpHealthOff')}
              </p>
            </div>
            <div className="agent-field">
              <span className="wn-label">{t('agent.mcpStageRule')}</span>
              <p className="agent-settings-hint">{t('agent.mcpStageRuleHint')}</p>
              <button
                type="button"
                className="wn-btn wn-btn-sm"
                disabled={stageBusy}
                {...pressProps(() => void onEnsureStageRules(), { disabled: stageBusy })}
              >
                {stageBusy ? t('agent.mcpStageRuleWriting') : t('agent.mcpStageRuleWrite')}
              </button>
            </div>
            <div className="agent-field">
              <span className="wn-label">{t('agent.mcpUserProjectStageRule')}</span>
              <p className="agent-settings-hint">{t('agent.mcpUserProjectStageRuleHint')}</p>
              <div className="agent-mcp-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="wn-btn wn-btn-sm"
                  disabled={stageBusy}
                  {...pressProps(() => void onEnsureUserProjectStageRule(), { disabled: stageBusy })}
                >
                  {stageBusy ? t('agent.mcpUserProjectStageRuleWriting') : t('agent.mcpUserProjectStageRuleWrite')}
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-ghost"
                  disabled={stageBusy}
                  {...pressProps(() => void onRemoveUserProjectStageRule(), { disabled: stageBusy })}
                >
                  {t('agent.mcpUserProjectStageRuleRemove')}
                </button>
              </div>
              {stageMsg ? <p className="agent-settings-hint">{stageMsg}</p> : null}
            </div>
            <div className="agent-field">
              <span className="wn-label">{t('agent.mcpTrustOps')}</span>
              <p className="agent-settings-hint">{t('agent.mcpTrustOpsHint')}</p>
              {trustOps.length === 0 ? (
                <p className="agent-settings-hint">{t('agent.mcpTrustOpsEmpty')}</p>
              ) : (
                <ul className="agent-mcp-trust-list" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
                  {trustOps.map((op) => (
                    <li
                      key={op.fingerprint}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        padding: '8px 0',
                        borderTop: '1px solid var(--wn-border, #3333)',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>
                          {op.tool}
                          {op.summary ? ` · ${op.summary}` : ''}
                        </div>
                        <div className="agent-settings-hint">
                          {t('agent.mcpTrustOpsHost')}: {op.hostKey || 'local'}
                          {op.risk ? ` · ${t('agent.mcpTrustOpsRisk')}: ${op.risk}` : ''}
                          {` · ${op.fingerprint.slice(0, 12)}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="wn-btn wn-btn-sm wn-btn-ghost"
                        disabled={trustBusy}
                        {...pressProps(
                          () => {
                            void (async () => {
                              setTrustBusy(true)
                              try {
                                await api.revokeMCPTrustOp(op.fingerprint)
                                await refreshTrustOps()
                                setStageMsg(t('agent.mcpTrustOpsRevoked'))
                              } catch (e) {
                                setMcpError((e as Error).message)
                              } finally {
                                setTrustBusy(false)
                              }
                            })()
                          },
                          { disabled: trustBusy },
                        )}
                      >
                        {t('agent.mcpTrustOpsRevoke')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="agent-mcp-json-head">
              <span className="wn-label">{t('agent.mcpCursorSnippet')}</span>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-ghost"
                disabled={!snippet}
                {...pressProps(() => void onCopySnippet(), { disabled: !snippet })}
              >
                {copied ? t('agent.mcpCopied') : t('agent.mcpCopySnippet')}
              </button>
            </div>
            <pre className="agent-mcp-json">{snippet}</pre>
          </div>
        ) : (
          <div className="agent-config-main" role="tabpanel">
            {error && <p className="agent-settings-error">{error}</p>}
            {provider !== 'cursor' && (
              <div className="agent-field">
                <label className="wn-label" htmlFor="agent-api-base">
                  {t('agent.apiBase')}
                </label>
                <input
                  id="agent-api-base"
                  className="wn-input"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
            <div className="agent-field">
              <label className="wn-label" htmlFor="agent-api-key">
                {provider === 'cursor' ? t('agent.cursorApiKey') : t('agent.apiKey')}
              </label>
              <input
                id="agent-api-key"
                className="wn-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? t('agent.apiKeyKeep') : t('agent.apiKeyPlaceholder')}
                spellCheck={false}
              />
            </div>
            <div className="agent-field">
              <label className="wn-label" htmlFor="agent-model">
                {t('agent.model')}
              </label>
              <input
                id="agent-model"
                className="wn-input"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={modelPlaceholder(provider)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              {savedModels.length > 0 && (
                <div className="agent-model-saved">
                  <span className="agent-model-saved-label">{t('agent.savedModels')}</span>
                  {savedModels.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`agent-model-chip${id === modelName.trim() ? ' is-current' : ''}`}
                      title={id}
                      {...pressProps(() => setModelName(id))}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="agent-config-actions">
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-ghost"
                disabled={busy}
                {...pressProps(onTest, { disabled: busy })}
              >
                {testing ? t('agent.testing') : t('agent.testConnection')}
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-primary"
                disabled={saving}
                {...pressProps(onSave, { disabled: saving })}
              >
                {saving ? t('common.saving') : t('agent.saveConfig')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function buildAPIConfigSave(apiBase: string, apiKey: string, modelName: string, provider: string) {
  const base = provider === 'cursor' ? 'cursor-sdk-bridge://local' : apiBase.trim()
  return model.AgentAPIConfigSaveDO.createFrom({
    apiBase: base,
    apiKey: apiKey.trim(),
    model: modelName.trim(),
    provider,
  })
}

export async function saveAgentAPIConfig(apiBase: string, apiKey: string, modelName: string, provider: string) {
  return api.saveAgentAPIConfig(buildAPIConfigSave(apiBase, apiKey, modelName, provider))
}

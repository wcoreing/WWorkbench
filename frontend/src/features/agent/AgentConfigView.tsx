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

type SettingsPane = AgentProviderPresetId | 'mcp' | 'notify'

const NOTIFY_WECOM_KEY = 'notify.wecom_webhook'

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
  const [showNotify, setShowNotify] = useState(false)
  const [mcpStatus, setMcpStatus] = useState<model.MCPStatusDO | null>(null)
  const [mcpError, setMcpError] = useState('')
  const [copied, setCopied] = useState(false)
  const [wecomWebhook, setWecomWebhook] = useState('')
  const [notifySaving, setNotifySaving] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState('')
  const pane: SettingsPane | '' = showNotify
    ? 'notify'
    : showMcp
      ? 'mcp'
      : isPreset(provider)
        ? provider
        : ''
  const savedModels = loadSavedModels(provider)

  const refreshMCP = useCallback(async () => {
    const st = await api.getMCPStatus()
    setMcpStatus(st)
    setMcpError(st.error || '')
  }, [])

  const refreshNotify = useCallback(async () => {
    const all = await api.listAppSettings()
    setWecomWebhook(String(all[NOTIFY_WECOM_KEY] ?? ''))
  }, [])

  useEffect(() => {
    void refreshMCP().catch((e) => setMcpError((e as Error).message))
  }, [refreshMCP])

  useEffect(() => {
    if (!showNotify) return
    void refreshNotify().catch(() => {})
  }, [showNotify, refreshNotify])

  const onCopySnippet = async () => {
    await copyText(mcpStatus?.cursorSnippet || '')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const busy = testing || saving
  const snippet = mcpStatus?.cursorSnippet || ''

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
                setShowNotify(false)
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
            {...pressProps(() => {
              setShowNotify(false)
              setShowMcp(true)
            })}
          >
            MCP
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'notify'}
            className={`agent-provider-item${pane === 'notify' ? ' is-active' : ''}`}
            {...pressProps(() => {
              setShowMcp(false)
              setShowNotify(true)
            })}
          >
            {t('agent.notifyTab')}
          </button>
        </div>

        {pane === 'mcp' ? (
          <div className="agent-config-main" role="tabpanel">
            {mcpError && <p className="agent-settings-error">{mcpError}</p>}
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
        ) : pane === 'notify' ? (
          <div className="agent-config-main" role="tabpanel">
            <p className="agent-settings-hint">{t('agent.notifyWecomHint')}</p>
            <div className="agent-field">
              <label className="wn-label" htmlFor="agent-notify-wecom">
                {t('agent.notifyWecomWebhook')}
              </label>
              <input
                id="agent-notify-wecom"
                className="wn-input"
                value={wecomWebhook}
                onChange={(e) => setWecomWebhook(e.target.value)}
                placeholder={t('agent.notifyWecomPlaceholder')}
                spellCheck={false}
              />
            </div>
            {notifyMsg ? <p className="agent-settings-hint">{notifyMsg}</p> : null}
            <div className="agent-config-actions">
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-ghost"
                disabled={notifySaving || !wecomWebhook.trim()}
                {...pressProps(
                  () => {
                    setNotifySaving(true)
                    void api
                      .setAppSetting(NOTIFY_WECOM_KEY, '')
                      .then(() => {
                        setWecomWebhook('')
                        setNotifyMsg(t('agent.notifyWecomSaved'))
                      })
                      .catch((e) => setNotifyMsg((e as Error).message))
                      .finally(() => setNotifySaving(false))
                  },
                  { disabled: notifySaving || !wecomWebhook.trim() },
                )}
              >
                {t('agent.notifyWecomClear')}
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-primary"
                disabled={notifySaving || !wecomWebhook.trim()}
                {...pressProps(
                  () => {
                    setNotifySaving(true)
                    void api
                      .setAppSetting(NOTIFY_WECOM_KEY, wecomWebhook.trim())
                      .then(() => setNotifyMsg(t('agent.notifyWecomSaved')))
                      .catch((e) => setNotifyMsg((e as Error).message))
                      .finally(() => setNotifySaving(false))
                  },
                  { disabled: notifySaving || !wecomWebhook.trim() },
                )}
              >
                {notifySaving ? t('common.saving') : t('agent.notifyWecomSave')}
              </button>
            </div>
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

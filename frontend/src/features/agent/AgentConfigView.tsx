import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'

export type AgentProviderId = 'bailian' | 'deepseek' | 'minimax' | string

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
  onApplyPreset: (provider: 'bailian' | 'deepseek' | 'minimax') => void
  onTest: () => void
  onSave: () => void
}

const PRESETS: { id: 'bailian' | 'deepseek' | 'minimax'; labelKey: string }[] = [
  { id: 'bailian', labelKey: 'agent.bailianPreset' },
  { id: 'deepseek', labelKey: 'agent.deepseekPreset' },
  { id: 'minimax', labelKey: 'agent.minimaxPreset' },
]

const DEEPSEEK_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const

/** providerLabel 服务商标签文案。 */
export function providerLabel(provider: string, t: (key: string) => string): string {
  switch (provider) {
    case 'bailian':
      return t('agent.providerBailian')
    case 'deepseek':
      return t('agent.providerDeepseek')
    case 'minimax':
      return t('agent.providerMinimax')
    default:
      return t('agent.providerOther')
  }
}

/** providerHint 当前服务商配置提示。 */
function providerHint(provider: string, t: (key: string) => string): string {
  switch (provider) {
    case 'deepseek':
      return t('agent.deepseekHint')
    case 'minimax':
      return t('agent.minimaxHint')
    case 'bailian':
      return t('agent.bailianHint')
    default:
      return t('agent.openaiCompatHint')
  }
}

/** modelPlaceholder 模型输入占位。 */
function modelPlaceholder(provider: string): string {
  switch (provider) {
    case 'deepseek':
      return 'deepseek-v4-pro'
    case 'minimax':
      return 'MiniMax-M2.5 / MiniMax-M3'
    case 'bailian':
      return 'qwen-plus / qwen-turbo'
    default:
      return 'model-id'
  }
}

/** deepseekModelValue 规范化 DeepSeek 模型选择值。 */
function deepseekModelValue(modelName: string): string {
  return (DEEPSEEK_MODELS as readonly string[]).includes(modelName)
    ? modelName
    : DEEPSEEK_MODELS[0]
}

async function copyText(text: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* ignore */
  }
}

/** AgentConfigView AI 连接设置（API / 模型 / MCP）。 */
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
  const [mcpEnabled, setMcpEnabled] = useState(true)
  const [mcpAddr, setMcpAddr] = useState('')
  const [mcpStatus, setMcpStatus] = useState<model.MCPStatusDO | null>(null)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [copied, setCopied] = useState('')

  const refreshMCP = useCallback(async () => {
    const st = await api.getMCPStatus()
    setMcpStatus(st)
    setMcpEnabled(st.configured)
    setMcpAddr(st.addr || '')
    if (st.error) setMcpError(st.error)
    else setMcpError('')
  }, [])

  useEffect(() => {
    void refreshMCP().catch((e) => setMcpError((e as Error).message))
  }, [refreshMCP])

  const saveMCP = async () => {
    setMcpSaving(true)
    setMcpError('')
    try {
      const st = await api.saveMCPConfig(
        model.MCPConfigSaveDO.createFrom({
          enabled: mcpEnabled,
          addr: mcpAddr.trim(),
        }),
      )
      setMcpStatus(st)
      setMcpEnabled(st.configured)
      setMcpAddr(st.addr || '')
      if (st.error) setMcpError(st.error)
    } catch (e) {
      setMcpError((e as Error).message)
    } finally {
      setMcpSaving(false)
    }
  }

  const onCopy = async (kind: string, text: string) => {
    await copyText(text)
    setCopied(kind)
    window.setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="agent-subview agent-config-view">
      <p className="agent-subview-title">{t('agent.configTitle')}</p>
      {error && <p className="agent-settings-error">{error}</p>}
      <div className="agent-settings-row agent-preset-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`wn-btn wn-btn-sm wn-btn-tool${provider === p.id ? ' active' : ''}`}
            onClick={() => onApplyPreset(p.id)}
          >
            {t(p.labelKey)}
          </button>
        ))}
        <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={testing || saving} onClick={onTest}>
          {testing ? t('agent.testing') : t('agent.testConnection')}
        </button>
        <span className="agent-provider-tag">{providerLabel(provider, t)}</span>
      </div>
      <label className="wn-label">{t('agent.apiBase')}</label>
      <input className="wn-input" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
      <label className="wn-label">{t('agent.apiKey')}</label>
      <input
        className="wn-input"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={hasKey ? t('agent.apiKeyKeep') : t('agent.apiKeyPlaceholder')}
      />
      <label className="wn-label">{t('agent.model')}</label>
      {provider === 'deepseek' ? (
        <select
          className="wn-select"
          value={deepseekModelValue(modelName)}
          onChange={(e) => setModelName(e.target.value)}
        >
          {DEEPSEEK_MODELS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="wn-input"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder={modelPlaceholder(provider)}
        />
      )}
      <p className="agent-settings-hint">{providerHint(provider, t)}</p>
      <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={onSave}>
        {saving ? t('common.saving') : t('agent.saveConfig')}
      </button>

      <p className="agent-subview-title agent-mcp-title">{t('agent.mcpTitle')}</p>
      {mcpError && <p className="agent-settings-error">{mcpError}</p>}
      <label className="agent-check-row">
        <input type="checkbox" checked={mcpEnabled} onChange={(e) => setMcpEnabled(e.target.checked)} />
        <span>{t('agent.mcpEnabled')}</span>
      </label>
      <label className="wn-label">{t('agent.mcpAddr')}</label>
      <input
        className="wn-input"
        value={mcpAddr}
        onChange={(e) => setMcpAddr(e.target.value)}
        placeholder="127.0.0.1:51021"
      />
      <p className="agent-settings-hint">{t('agent.mcpHint')}</p>
      {mcpStatus?.workbenchUrl && (
        <div className="agent-mcp-urls">
          <div className="agent-mcp-url-row">
            <span className="agent-mcp-url-label">{t('agent.mcpWorkbenchUrl')}</span>
            <code className="agent-mcp-url">{mcpStatus.workbenchUrl}</code>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost"
              onClick={() => void onCopy('wb', mcpStatus.workbenchUrl)}
            >
              {copied === 'wb' ? t('agent.mcpCopied') : t('common.copy')}
            </button>
          </div>
          {mcpStatus.mcpUrl && (
            <div className="agent-mcp-url-row">
              <span className="agent-mcp-url-label">{t('agent.mcpCoreUrl')}</span>
              <code className="agent-mcp-url">{mcpStatus.mcpUrl}</code>
              <button
                type="button"
                className="wn-btn wn-btn-xs wn-btn-ghost"
                onClick={() => void onCopy('core', mcpStatus.mcpUrl)}
              >
                {copied === 'core' ? t('agent.mcpCopied') : t('common.copy')}
              </button>
            </div>
          )}
          {mcpStatus.listenAddr && (
            <p className="agent-settings-hint">
              {t('agent.mcpListen')}: {mcpStatus.listenAddr}
              {mcpStatus.enabled ? ` · ${t('agent.mcpRunning')}` : ` · ${t('agent.mcpStopped')}`}
            </p>
          )}
        </div>
      )}
      <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={mcpSaving} onClick={() => void saveMCP()}>
        {mcpSaving ? t('common.saving') : t('agent.mcpSave')}
      </button>
    </div>
  )
}

/** buildAPIConfigSave 构建 API 配置保存参数。 */
export function buildAPIConfigSave(
  apiBase: string,
  apiKey: string,
  modelName: string,
  provider: string,
) {
  const resolvedModel =
    provider === 'deepseek' ? deepseekModelValue(modelName.trim()) : modelName.trim()
  return model.AgentAPIConfigSaveDO.createFrom({
    apiBase: apiBase.trim(),
    apiKey: apiKey.trim(),
    model: resolvedModel,
    provider,
  })
}

/** saveAgentAPIConfig 保存 API 配置。 */
export async function saveAgentAPIConfig(
  apiBase: string,
  apiKey: string,
  modelName: string,
  provider: string,
) {
  return api.saveAgentAPIConfig(buildAPIConfigSave(apiBase, apiKey, modelName, provider))
}

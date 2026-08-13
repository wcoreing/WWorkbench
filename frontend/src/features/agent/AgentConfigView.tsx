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
      return 'deepseek-chat / deepseek-reasoner'
    case 'minimax':
      return 'MiniMax-M2.5 / MiniMax-M3'
    case 'bailian':
      return 'qwen-plus / qwen-turbo'
    default:
      return 'model-id'
  }
}

/** AgentConfigView AI 连接设置（API / 模型）。 */
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
      <input
        className="wn-input"
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
        placeholder={modelPlaceholder(provider)}
      />
      <p className="agent-settings-hint">{providerHint(provider, t)}</p>
      <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={onSave}>
        {saving ? t('common.saving') : t('agent.saveConfig')}
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
  return model.AgentAPIConfigSaveDO.createFrom({
    apiBase: apiBase.trim(),
    apiKey: apiKey.trim(),
    model: modelName.trim(),
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

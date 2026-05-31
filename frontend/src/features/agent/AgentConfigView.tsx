import { useI18n } from '../../i18n'
import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'

export interface AgentConfigViewProps {
  apiBase: string
  setApiBase: (v: string) => void
  apiKey: string
  setApiKey: (v: string) => void
  modelName: string
  setModelName: (v: string) => void
  hasKey: boolean
  provider: string
  error: string
  saving: boolean
  testing: boolean
  onApplyBailian: () => void
  onTest: () => void
  onSave: () => void
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
  onApplyBailian,
  onTest,
  onSave,
}: AgentConfigViewProps) {
  const { t } = useI18n()

  return (
    <div className="agent-subview agent-config-view">
      <p className="agent-subview-title">{t('agent.configTitle')}</p>
      {error && <p className="agent-settings-error">{error}</p>}
      <div className="agent-settings-row">
        <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={onApplyBailian}>
          {t('agent.bailianPreset')}
        </button>
        <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={testing || saving} onClick={onTest}>
          {testing ? t('agent.testing') : t('agent.testConnection')}
        </button>
        <span className="agent-provider-tag">{provider === 'bailian' ? t('agent.providerBailian') : t('agent.providerOther')}</span>
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
        placeholder="qwen-plus / qwen-turbo"
      />
      <p className="agent-settings-hint">{t('agent.bailianHint')}</p>
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

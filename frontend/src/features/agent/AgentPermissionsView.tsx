import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import { api } from '../../api/client'
import type { CapabilityRow } from './agentTypes'

/** riskLabel 风险级别文案。 */
function riskLabel(t: (k: string) => string, risk: string) {
  if (risk === 'write') return t('agent.riskWrite')
  if (risk === 'session') return t('agent.riskSession')
  return t('agent.riskRead')
}

export interface AgentPermissionsViewProps {
  capabilities: CapabilityRow[]
  unavailableNote: string
  allowWrite: boolean
  setAllowWrite: (v: boolean) => void
  onToggle: (name: string) => void
  error: string
  saving: boolean
  onSave: () => void
}

/** AgentPermissionsView AI 能力权限配置。 */
export function AgentPermissionsView({
  capabilities,
  unavailableNote,
  allowWrite,
  setAllowWrite,
  onToggle,
  error,
  saving,
  onSave,
}: AgentPermissionsViewProps) {
  const { t } = useI18n()

  return (
    <div className="agent-subview agent-permissions-view">
      <p className="agent-subview-title">{t('agent.permissionsTitle')}</p>
      {error && <p className="agent-settings-error">{error}</p>}
      {unavailableNote && <p className="agent-settings-hint">{unavailableNote}</p>}

      <label className="agent-check">
        <input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} />
        {t('agent.allowWrite')}
      </label>

      <ul className="agent-cap-list">
        {capabilities.map((c) => (
          <li key={c.name} className="agent-cap-item">
            <label className="agent-cap-label">
              <input type="checkbox" checked={c.enabled} onChange={() => onToggle(c.name)} />
              <span className="agent-cap-name">{c.label}</span>
              <span className={`agent-cap-risk agent-cap-risk-${c.risk}`}>{riskLabel(t, c.risk)}</span>
            </label>
            <span className="agent-cap-desc">{c.description}</span>
            {c.needsConfirm && <span className="agent-cap-badge">{t('agent.needsConfirmBadge')}</span>}
          </li>
        ))}
      </ul>

      <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={onSave}>
        {saving ? t('common.saving') : t('agent.savePermissions')}
      </button>
    </div>
  )
}

/** buildPermissionsSave 构建权限保存参数。 */
export function buildPermissionsSave(allowWrite: boolean, capabilities: CapabilityRow[]) {
  const m: Record<string, boolean> = {}
  for (const c of capabilities) m[c.name] = c.enabled
  return model.AgentPermissionsSaveDO.createFrom({
    allowWrite,
    toolPermissionsJson: JSON.stringify(m),
  })
}

/** saveAgentPermissions 保存权限配置。 */
export async function saveAgentPermissions(allowWrite: boolean, capabilities: CapabilityRow[]) {
  return api.saveAgentPermissions(buildPermissionsSave(allowWrite, capabilities))
}

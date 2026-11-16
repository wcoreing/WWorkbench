import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import { api } from '../../api/client'
import type { DesktopAppGrant } from '../../api/types'
import { pressProps } from '../../components/compat'
import { notify } from '../../notify'
import type { CapabilityRow } from './agentTypes'

/** DesktopGrantsSection 允许 AI 读取 / 操作的桌面应用：授权由 AI 首次用到时弹窗产生，这里只负责查看与撤销。 */
function DesktopGrantsSection() {
  const { t } = useI18n()
  const [grants, setGrants] = useState<DesktopAppGrant[]>([])

  const reload = useCallback(() => {
    api
      .listDesktopAppGrants()
      .then(setGrants)
      .catch(() => setGrants([]))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const revoke = async (g: DesktopAppGrant) => {
    try {
      await api.revokeDesktopAppGrant(g.key)
      notify.success(t('agent.desktopRevoked', { app: g.name || g.key }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : String(err))
    }
    reload()
  }

  return (
    <section className="agent-cap-section">
      <p className="agent-subview-title">{t('agent.desktopAppsTitle')}</p>
      <p className="agent-settings-hint">{t('agent.desktopAppsHint')}</p>
      {grants.length > 0 && (
        <ul className="agent-cap-list">
          {grants.map((g) => (
            <li key={g.key} className="agent-cap-item">
              <div className="agent-cap-label agent-cap-label-static">
                <span className="agent-cap-name">{g.name || g.key}</span>
                <span className={`agent-cap-risk agent-cap-risk-${g.level === 'act' ? 'write' : 'read'}`}>
                  {g.level === 'act' ? t('agent.desktopLevelAct') : t('agent.desktopLevelRead')}
                </span>
                <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" {...pressProps(() => void revoke(g))}>
                  {t('agent.desktopRevoke')}
                </button>
              </div>
              {g.name && g.key !== g.name && <span className="agent-cap-desc">{g.key}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

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
          </li>
        ))}
      </ul>

      <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={onSave}>
        {saving ? t('common.saving') : t('agent.savePermissions')}
      </button>

      <DesktopGrantsSection />
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

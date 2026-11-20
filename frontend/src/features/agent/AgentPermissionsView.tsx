import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import { api } from '../../api/client'
import type { DesktopAppGrant } from '../../api/types'
import { pressProps } from '../../components/compat'
import { notify } from '../../notify'
import type { CapabilityRow } from './agentTypes'
import { DOMAIN_ORDER } from './agentTypes'

const DESKTOP_NAV = 'desktop-grants'

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
    <div className="agent-perm-pane-body">
      <p className="agent-settings-hint">{t('agent.desktopAppsHint')}</p>
      {grants.length === 0 ? (
        <p className="agent-settings-hint">{t('agent.desktopAppsEmpty')}</p>
      ) : (
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
    </div>
  )
}

/** riskLabel 风险级别文案。 */
function riskLabel(t: (k: string) => string, risk: string) {
  if (risk === 'write') return t('agent.riskWrite')
  if (risk === 'session') return t('agent.riskSession')
  return t('agent.riskRead')
}

function domainTitle(t: (k: string, p?: Record<string, string | number>) => string, domain: string) {
  const key = `agent.domain.${domain}`
  const label = t(key)
  return label === key ? domain : label
}

export interface AgentPermissionsViewProps {
  capabilities: CapabilityRow[]
  allowWrite: boolean
  setAllowWrite: (v: boolean) => void
  onToggle: (name: string) => void
  error: string
  saving: boolean
  onSave: () => void
  onResetRecommended: () => void
  resetting?: boolean
}

/** AgentPermissionsView AI 能力权限：左栏选域，右栏开关。 */
export function AgentPermissionsView({
  capabilities,
  allowWrite,
  setAllowWrite,
  onToggle,
  error,
  saving,
  onSave,
  onResetRecommended,
  resetting = false,
}: AgentPermissionsViewProps) {
  const { t } = useI18n()

  const grouped = useMemo(() => {
    const map = new Map<string, CapabilityRow[]>()
    for (const c of capabilities) {
      const d = c.domain || 'other'
      const list = map.get(d) ?? []
      list.push(c)
      map.set(d, list)
    }
    const domains = [
      ...DOMAIN_ORDER.filter((d) => map.has(d)),
      ...[...map.keys()].filter((d) => !(DOMAIN_ORDER as readonly string[]).includes(d)),
    ]
    return domains.map((d) => {
      const items = map.get(d) ?? []
      const on = items.filter((c) => c.enabled).length
      return { domain: d, items, on, total: items.length }
    })
  }, [capabilities])

  const [active, setActive] = useState<string>('')
  useEffect(() => {
    if (active === DESKTOP_NAV) return
    if (active && grouped.some((g) => g.domain === active)) return
    setActive(grouped[0]?.domain ?? DESKTOP_NAV)
  }, [grouped, active])

  const activeGroup = grouped.find((g) => g.domain === active)

  const toggleDomain = (on: boolean) => {
    if (!activeGroup) return
    for (const c of activeGroup.items) {
      if (c.enabled !== on) onToggle(c.name)
    }
  }

  return (
    <div className="agent-subview agent-permissions-view">
      <header className="agent-perm-head">
        {error ? <p className="agent-settings-error agent-perm-head-error">{error}</p> : <span />}
        <div className="agent-perm-actions">
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={onSave}>
            {saving ? t('common.saving') : t('agent.savePermissions')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-tool"
            disabled={resetting || saving}
            {...pressProps(onResetRecommended)}
          >
            {resetting ? t('common.saving') : t('agent.resetPermissionsRecommended')}
          </button>
        </div>
      </header>

      <div className="agent-perm-split">
        <nav className="agent-perm-nav" aria-label={t('agent.permissionsTitle')}>
          {grouped.map(({ domain, on, total }) => (
            <button
              key={domain}
              type="button"
              className={`agent-perm-nav-item${active === domain ? ' is-active' : ''}`}
              {...pressProps(() => setActive(domain))}
            >
              <span className="agent-perm-nav-label">{domainTitle(t, domain)}</span>
              <span className="agent-perm-nav-count">
                {on}/{total}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`agent-perm-nav-item${active === DESKTOP_NAV ? ' is-active' : ''}`}
            {...pressProps(() => setActive(DESKTOP_NAV))}
          >
            <span className="agent-perm-nav-label">{t('agent.desktopAppsTitle')}</span>
          </button>
        </nav>

        <div className="agent-perm-pane">
          {active === DESKTOP_NAV ? (
            <>
              <div className="agent-perm-pane-head">
                <h3 className="agent-perm-pane-title">{t('agent.desktopAppsTitle')}</h3>
              </div>
              <DesktopGrantsSection />
            </>
          ) : activeGroup ? (
            <>
              <div className="agent-perm-pane-head">
                <h3 className="agent-perm-pane-title">{domainTitle(t, activeGroup.domain)}</h3>
                <div className="agent-perm-pane-tools">
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" {...pressProps(() => toggleDomain(true))}>
                    {t('agent.domainEnableAll')}
                  </button>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" {...pressProps(() => toggleDomain(false))}>
                    {t('agent.domainDisableAll')}
                  </button>
                </div>
              </div>
              <div className="agent-perm-pane-body">
                {activeGroup.domain === 'database' ? (
                  <label className="agent-check agent-perm-db-write">
                    <input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} />
                    <span>
                      {t('agent.allowWrite')}
                      <span className="agent-cap-desc">{t('agent.allowWriteHint')}</span>
                    </span>
                  </label>
                ) : null}
                <ul className="agent-cap-list">
                  {activeGroup.items.map((c) => (
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
              </div>
            </>
          ) : null}
        </div>
      </div>
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

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { IconGlobe, IconLayers, IconRefresh } from '../../components/Icons'
import { pressProps } from '../../components/compat'
import { SkillShelfPanel } from '../../features/skillmarket/SkillShelfPanel'
import { useI18n } from '../../i18n'
import { emptyAgentSurface } from '../../stores/agentSurface'
import { useAppStore } from '../../stores/appStore'
import { model } from '../../../wailsjs/go/models'
import './skillmarket.css'

type Pane = 'market' | 'local'

/**
 * SkillMarketWorkbench 技能市场一级产品。
 * 云端是技能仓库（定位同 GitHub）：一个技能一个固定 id，提交在行内切换。本机表推送当前提交，检出尚未在文档库的提交。
 */
export function SkillMarketWorkbench() {
  const { t } = useI18n()
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const setAgentSurface = useAppStore((s) => s.setAgentSurface)
  const [pane, setPane] = useState<Pane>('market')
  const [home, setHome] = useState<model.HomeStatusDO | null>(null)
  const [tick, setTick] = useState(0)

  const refreshHome = useCallback(async () => {
    try {
      setHome(await api.getHomeStatus())
    } catch {
      setHome(null)
    }
  }, [])

  useEffect(() => {
    void refreshHome()
  }, [refreshHome, tick])

  useEffect(() => {
    setAgentSurface({
      focusKind: 'skillmarket',
      focusLabel: t('products.skillmarket.label'),
      selectionBrief: `pane=${pane}`,
    })
    return () => setAgentSurface(emptyAgentSurface())
  }, [pane, setAgentSurface, t])

  const focus = pane === 'market' ? 'remote' : 'local'

  return (
    <div className="skillmarket-workbench">
      <header className="skillmarket-header">
        <div className="skillmarket-header-text">
          <h1 className="skillmarket-title">{t('products.skillmarket.label')}</h1>
          <p className="skillmarket-desc">{t('products.skillmarket.description')}</p>
        </div>
        <div className="skillmarket-header-actions">
          <span className="pane-meta">
            {home?.loggedIn
              ? t('shell.accountAs', { name: home.username || home.accountId || '—' })
              : t('skillmarket.needLogin')}
          </span>
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={t('common.refresh')}
            {...pressProps(() => {
              setTick((n) => n + 1)
              setStatusMessage(t('skillmarket.refreshed'))
            })}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </header>

      <div className="skillmarket-body">
        <nav className="skillmarket-nav" aria-label={t('products.skillmarket.label')}>
          <button
            type="button"
            className={`skillmarket-nav-btn${pane === 'market' ? ' is-active' : ''}`}
            {...pressProps(() => setPane('market'))}
          >
            <IconGlobe size={16} />
            <span>{t('skillmarket.navRemote')}</span>
          </button>
          <button
            type="button"
            className={`skillmarket-nav-btn${pane === 'local' ? ' is-active' : ''}`}
            {...pressProps(() => setPane('local'))}
          >
            <IconLayers size={16} />
            <span>{t('skillmarket.navLocal')}</span>
          </button>
        </nav>

        <main className="skillmarket-main">
          <SkillShelfPanel
            key={`${pane}-${tick}`}
            onInstalled={() => setTick((n) => n + 1)}
            focus={focus}
          />
        </main>
      </div>
    </div>
  )
}

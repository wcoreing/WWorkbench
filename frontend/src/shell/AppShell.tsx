import { Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useAppStore } from '../stores/appStore'
import { bootstrapAppState } from '../stores/bootstrapApp'
import { listRegisteredProductIds, resolveProductViews } from '../plugin/registry'
import { useMountedProductViews } from './useMountedProductViews'
import { ProductRail } from './ProductRail'
import { ShellChrome } from './ShellChrome'
import { StatusBar } from './StatusBar'
import { AgentPanel } from '../features/agent/AgentPanel'
import { subscribeAgentUiActions, subscribeMcpConfirm } from '../features/agent/agentUiActions'
import { startWorkbenchRadar } from '../workbench/workbenchRadar'
import { useAgentStore } from '../stores/agentStore'
import { ConfirmHost } from '../components/ConfirmHost'
import { installFocusGate } from '../components/compat'
import { useI18n } from '../i18n'
import type { ProductId } from './products'
import './shell.css'

/** 多产品线工作台壳 */
export function AppShell() {
  const { activeProduct, preferencesReady } = useAppStore()
  const { t } = useI18n()
  const [booting, setBooting] = useState(!preferencesReady)
  const agentOpen = useAgentStore((s) => s.panelOpen)
  const toggleAgent = useAgentStore((s) => s.togglePanel)
  const { mountedProducts } = useMountedProductViews(activeProduct)
  const productViews = useMemo(() => resolveProductViews(), [])
  const productKeys = useMemo(() => listRegisteredProductIds(), [])

  useEffect(() => {
    if (preferencesReady) {
      setBooting(false)
      return
    }
    void bootstrapAppState()
      .catch((err) => {
        console.error(err)
        useAppStore.getState().setStatusMessage(
          err instanceof Error ? err.message : String(err),
        )
      })
      .finally(() => setBooting(false))
  }, [preferencesReady])

  useEffect(() => {
    api.getVersion().then(useAppStore.getState().setVersion).catch((err) => {
      console.error(err)
    })
  }, [])

  useEffect(() => subscribeAgentUiActions(), [])
  useEffect(() => subscribeMcpConfirm(), [])
  useEffect(() => startWorkbenchRadar(), [])
  useEffect(() => installFocusGate(), [])

  if (booting) {
    return (
      <div className="workbench-shell">
        <div className="pane-empty">{t('shell.booting')}</div>
      </div>
    )
  }

  return (
    <div className={`workbench-shell${activeProduct === 'terminal' ? ' is-terminal-glass' : ''}`}>
      <ShellChrome agentOpen={agentOpen} onToggleAgent={toggleAgent} />
      <div className={`workbench-body${agentOpen ? ' agent-open' : ''}`}>
        <ProductRail />
        <div className="workbench-content">
          {productKeys.map((key: ProductId) => {
            if (!mountedProducts.has(key)) return null
            const View = productViews[key]
            const visible = activeProduct === key
            return (
              <div
                key={key}
                className={`product-view-host${visible ? ' is-active' : ''}`}
                hidden={!visible}
                aria-hidden={!visible}
              >
                <Suspense fallback={<div className="pane-empty">{t('shell.loadingProduct')}</div>}>
                  <View />
                </Suspense>
              </div>
            )
          })}
        </div>
        <AgentPanel collapsed={!agentOpen} />
      </div>
      <StatusBar />
      <ConfirmHost />
    </div>
  )
}

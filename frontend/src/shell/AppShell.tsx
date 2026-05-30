import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAppStore } from '../stores/appStore'
import { bootstrapAppState } from '../stores/bootstrapApp'
import { productLinkToProduct } from '../stores/productLink'
import { DockerWorkbench } from '../products/docker/DockerWorkbench'
import { DatabaseWorkbench } from '../products/database/DatabaseWorkbench'
import { EnvironmentWorkbench } from '../products/environment/EnvironmentWorkbench'
import { NotebookWorkbench } from '../products/notebook/NotebookWorkbench'
import { SftpWorkbench } from '../products/sftp/SftpWorkbench'
import { HttpApiWorkbench } from '../products/httpapi/HttpApiWorkbench'
import { TerminalWorkbench } from '../products/terminal/TerminalWorkbench'
import { ProductRail } from './ProductRail'
import { ShellChrome } from './ShellChrome'
import { StatusBar } from './StatusBar'
import { useI18n } from '../i18n'
import './shell.css'

const PRODUCT_VIEWS = {
  database: DatabaseWorkbench,
  terminal: TerminalWorkbench,
  sftp: SftpWorkbench,
  docker: DockerWorkbench,
  environment: EnvironmentWorkbench,
  notebook: NotebookWorkbench,
  httpapi: HttpApiWorkbench,
} as const

type ProductKey = keyof typeof PRODUCT_VIEWS

/** 多产品线工作台壳 */
export function AppShell() {
  const { activeProduct, preferencesReady, productLink } = useAppStore()
  const { t } = useI18n()
  const [booting, setBooting] = useState(!preferencesReady)
  const [mountedProducts, setMountedProducts] = useState<Set<ProductKey>>(
    () => new Set([activeProduct as ProductKey]),
  )

  useEffect(() => {
    if (preferencesReady) {
      setBooting(false)
      return
    }
    void bootstrapAppState()
      .catch(console.error)
      .finally(() => setBooting(false))
  }, [preferencesReady])

  useEffect(() => {
    api.getVersion().then(useAppStore.getState().setVersion).catch(console.error)
  }, [])

  useEffect(() => {
    setMountedProducts((prev) => {
      const key = activeProduct as ProductKey
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [activeProduct])

  useEffect(() => {
    if (!productLink) return
    const target = productLinkToProduct(productLink.action)
    if (!target) return
    setMountedProducts((prev) => {
      if (prev.has(target)) return prev
      const next = new Set(prev)
      next.add(target)
      return next
    })
  }, [productLink])

  if (booting) {
    return (
      <div className="workbench-shell">
        <div className="pane-empty">{t('shell.booting')}</div>
      </div>
    )
  }

  return (
    <div className="workbench-shell">
      <ShellChrome />
      <div className="workbench-body">
        <ProductRail />
        <div className="workbench-content">
          {(Object.keys(PRODUCT_VIEWS) as ProductKey[]).map((key) => {
            if (!mountedProducts.has(key)) return null
            const View = PRODUCT_VIEWS[key]
            const visible = activeProduct === key
            return (
              <div
                key={key}
                className={`product-view-host${visible ? ' is-active' : ''}`}
                hidden={!visible}
                aria-hidden={!visible}
              >
                <View />
              </div>
            )
          })}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

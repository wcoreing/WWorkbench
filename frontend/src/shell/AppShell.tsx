import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAppStore } from '../stores/appStore'
import { bootstrapAppState } from '../stores/bootstrapApp'
import { DockerWorkbench } from '../products/docker/DockerWorkbench'
import { DatabaseWorkbench } from '../products/database/DatabaseWorkbench'
import { EnvironmentWorkbench } from '../products/environment/EnvironmentWorkbench'
import { SftpWorkbench } from '../products/sftp/SftpWorkbench'
import { TerminalWorkbench } from '../products/terminal/TerminalWorkbench'
import { ProductRail } from './ProductRail'
import { ShellChrome } from './ShellChrome'
import { StatusBar } from './StatusBar'
import './shell.css'

const PRODUCT_VIEWS = {
  database: DatabaseWorkbench,
  terminal: TerminalWorkbench,
  sftp: SftpWorkbench,
  docker: DockerWorkbench,
  environment: EnvironmentWorkbench,
} as const

/** 多产品线工作台壳 */
export function AppShell() {
  const { activeProduct, preferencesReady } = useAppStore()
  const [booting, setBooting] = useState(!preferencesReady)
  const ProductView = PRODUCT_VIEWS[activeProduct]

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

  if (booting) {
    return (
      <div className="workbench-shell">
        <div className="pane-empty">正在恢复工作区…</div>
      </div>
    )
  }

  return (
    <div className="workbench-shell">
      <ShellChrome />
      <div className="workbench-body">
        <ProductRail />
        <div className="workbench-content">
          <ProductView />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

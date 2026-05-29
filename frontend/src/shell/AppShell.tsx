import { useEffect } from 'react'
import { api } from '../api/client'
import { useAppStore } from '../stores/appStore'
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
  const { activeProduct, theme, setVersion } = useAppStore()
  const ProductView = PRODUCT_VIEWS[activeProduct]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    api.getVersion().then(setVersion).catch(console.error)
  }, [theme, setVersion])

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

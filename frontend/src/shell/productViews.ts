import { lazy, type ComponentType } from 'react'
import type { ProductId } from './products'

function lazyNamed<T extends ComponentType>(
  loader: () => Promise<Record<string, T>>,
  exportName: string,
) {
  return lazy(async () => {
    const mod = await loader()
    return { default: mod[exportName] }
  })
}

/** 产品线工作台按需加载（首包不拉全量 Monaco / xterm / 各产品逻辑）。 */
export const PRODUCT_VIEWS: Record<ProductId, ComponentType> = {
  database: lazyNamed(() => import('../products/database/DatabaseWorkbench'), 'DatabaseWorkbench'),
  terminal: lazyNamed(() => import('../products/terminal/TerminalWorkbench'), 'TerminalWorkbench'),
  sftp: lazyNamed(() => import('../products/sftp/SftpWorkbench'), 'SftpWorkbench'),
  docker: lazyNamed(() => import('../products/docker/DockerWorkbench'), 'DockerWorkbench'),
  environment: lazyNamed(() => import('../products/environment/EnvironmentWorkbench'), 'EnvironmentWorkbench'),
  notebook: lazyNamed(() => import('../products/notebook/NotebookWorkbench'), 'NotebookWorkbench'),
  skills: lazyNamed(() => import('../products/skills/SkillsWorkbench'), 'SkillsWorkbench'),
  httpapi: lazyNamed(() => import('../products/httpapi/HttpApiWorkbench'), 'HttpApiWorkbench'),
  logs: lazyNamed(() => import('../products/logs/LogCenterWorkbench'), 'LogCenterWorkbench'),
}

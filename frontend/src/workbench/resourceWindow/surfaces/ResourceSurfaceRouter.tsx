import type { ResourceWindow } from '../types'
import { BackupResourceSurface } from './BackupResourceSurface'
import { DatabaseResourceSurface } from './DatabaseResourceSurface'
import { DockerResourceSurface } from './DockerResourceSurface'
import { HttpResourceSurface } from './HttpResourceSurface'
import { LogResourceSurface } from './LogResourceSurface'
import { NotebookResourceSurface } from './NotebookResourceSurface'
import { SftpResourceSurface } from './SftpResourceSurface'
import { TerminalResourceSurface } from './TerminalResourceSurface'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** ResourceSurfaceRouter 按 kind 选嵌入表面（与 Host 解耦）。 */
export function ResourceSurfaceRouter({ window: win, active }: Props) {
  switch (win.kind) {
    case 'ssh':
      return <TerminalResourceSurface window={win} active={active} />
    case 'note':
    case 'skill':
      return <NotebookResourceSurface window={win} active={active} />
    case 'log':
      return <LogResourceSurface window={win} active={active} />
    case 'database':
      return <DatabaseResourceSurface window={win} active={active} />
    case 'http':
      return <HttpResourceSurface window={win} active={active} />
    case 'docker':
      return <DockerResourceSurface window={win} active={active} />
    case 'backup':
      return <BackupResourceSurface window={win} active={active} />
    case 'sftp':
      return <SftpResourceSurface window={win} active={active} />
    default:
      return (
        <div className="rw-surface rw-surface-unsupported">
          <p>
            {win.kind}:{win.resourceId}
          </p>
        </div>
      )
  }
}

import type { ProductId } from '../shell/products'
import { Capability } from './capabilities'

/** capabilityToProductId 能力 ID 对应的产品线（用于切换与懒挂载）。 */
export function capabilityToProductId(capability: string): ProductId | null {
  switch (capability) {
    case Capability.TerminalOpen:
      return 'terminal'
    case Capability.DatabaseOpen:
      return 'database'
    case Capability.NotebookOpen:
      return 'notebook'
    case Capability.SftpOpen:
      return 'sftp'
    case Capability.DockerContextOpen:
      return 'docker'
    default:
      return null
  }
}

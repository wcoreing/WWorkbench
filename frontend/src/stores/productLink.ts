import type { ProductLinkRequest } from './appStore'
import { dispatchProductLink, type CommandSource } from '../workbench/workbenchCommandBus'

export type { CommandSource, WorkbenchCommand } from '../workbench/workbenchCommandBus'
export { useWorkbenchCommand } from '../workbench/useWorkbenchCommand'
export { capabilityToProductId } from '../workbench/routing'
export { productLinkActionToCapability, dispatchWorkbenchCommand } from '../workbench/workbenchCommandBus'

/** openProductLink 发起跨产品联动（统一走 CommandBus）。 */
export function openProductLink(link: ProductLinkRequest, source: CommandSource = 'user') {
  dispatchProductLink(link, source)
}

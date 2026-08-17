export type { CommandSource, WorkbenchCommand } from '../workbench/workbenchCommandBus'
export { useWorkbenchCommand } from '../workbench/useWorkbenchCommand'
export { capabilityToProductId } from '../workbench/routing'
export { dispatchWorkbenchCommand, openCapability } from '../workbench/workbenchCommandBus'
export {
  openTerminal,
  openSftp,
  openDatabase,
  openNotebook,
  openDockerContextFromHost,
  openLogs,
  openHttpApi,
  openEnvironment,
  openSSHForward,
} from '../workbench/assetOpen'

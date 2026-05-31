import { EventsEmit } from '../../wailsjs/runtime/runtime'
import type { ProductLinkAction, ProductLinkRequest } from '../stores/appStore'
import { useAppStore } from '../stores/appStore'
import { Capability, UI_CAPABILITIES } from './capabilities'
import { linkToCommandPayload } from './commandPayload'
import { capabilityToProductId } from './routing'

export type CommandSource = 'user' | 'notebook' | 'docker' | 'database' | 'terminal' | 'sftp' | 'agent'

export interface WorkbenchCommand {
  id: string
  capability: string
  source: CommandSource
  payload: Record<string, unknown>
}

export interface CommandResult {
  ok: boolean
  error?: string
}

type CommandHandler = (cmd: WorkbenchCommand) => void | Promise<void>

let cmdSeq = 0
const handlers = new Map<string, Set<CommandHandler>>()
const pendingByCapability = new Map<string, WorkbenchCommand[]>()

/** registerWorkbenchHandler 注册某能力的处理器（工作台挂载时调用）。 */
export function registerWorkbenchHandler(capability: string, fn: CommandHandler): () => void {
  let set = handlers.get(capability)
  if (!set) {
    set = new Set()
    handlers.set(capability, set)
  }
  set.add(fn)
  const queued = pendingByCapability.get(capability)
  if (queued?.length) {
    pendingByCapability.delete(capability)
    for (const cmd of queued) {
      for (const h of set) {
        void runHandler(capability, cmd, h)
      }
    }
  }
  return () => {
    set?.delete(fn)
    if (set?.size === 0) handlers.delete(capability)
  }
}

/** reportCommandResult 上报命令执行结果。 */
export function reportCommandResult(id: string, result: CommandResult, capability?: string) {
  EventsEmit('workbench:command:result', { id, capability, ...result })
}

/** productLinkActionToCapability 旧 action 映射到统一能力 ID。 */
export function productLinkActionToCapability(action: ProductLinkAction): string | null {
  switch (action) {
    case 'terminal':
      return Capability.TerminalOpen
    case 'database':
      return Capability.DatabaseOpen
    case 'notebook':
      return Capability.NotebookOpen
    case 'sftp':
      return Capability.SftpOpen
    case 'docker-context':
      return Capability.DockerContextOpen
    default:
      return null
  }
}

/** activateProductForCapability 切换到目标产品线并触发懒挂载。 */
function activateProductForCapability(capability: string) {
  const product = capabilityToProductId(capability)
  if (product) useAppStore.getState().setActiveProduct(product)
}

async function runHandler(capability: string, cmd: WorkbenchCommand, fn: CommandHandler) {
  try {
    await fn(cmd)
    reportCommandResult(cmd.id, { ok: true }, capability)
  } catch (e) {
    reportCommandResult(cmd.id, { ok: false, error: (e as Error).message }, capability)
  }
}

/** dispatchWorkbenchCommand 分发工作台命令（仅走已注册 handler，不经 productLink）。 */
export async function dispatchWorkbenchCommand(
  input: Omit<WorkbenchCommand, 'id'> & { id?: string },
): Promise<CommandResult> {
  const cmd: WorkbenchCommand = {
    id: input.id ?? `cmd-${++cmdSeq}`,
    capability: input.capability,
    source: input.source,
    payload: input.payload ?? {},
  }

  if (UI_CAPABILITIES.has(cmd.capability)) {
    activateProductForCapability(cmd.capability)
    const set = handlers.get(cmd.capability)
    if (!set || set.size === 0) {
      const q = pendingByCapability.get(cmd.capability) ?? []
      q.push(cmd)
      pendingByCapability.set(cmd.capability, q)
      return { ok: true }
    }
    await Promise.all([...set].map((fn) => runHandler(cmd.capability, cmd, fn)))
    return { ok: true }
  }

  const set = handlers.get(cmd.capability)
  if (!set || set.size === 0) {
    const err = `未注册处理器: ${cmd.capability}`
    reportCommandResult(cmd.id, { ok: false, error: err }, cmd.capability)
    return { ok: false, error: err }
  }
  await Promise.all([...set].map((fn) => runHandler(cmd.capability, cmd, fn)))
  return { ok: true }
}

/** dispatchProductLink 兼容旧 ProductLinkRequest 调用。 */
export function dispatchProductLink(link: ProductLinkRequest, source: CommandSource = 'user') {
  const capability = productLinkActionToCapability(link.action)
  if (!capability) return
  void dispatchWorkbenchCommand({
    capability,
    source,
    payload: linkToCommandPayload(link),
  })
}

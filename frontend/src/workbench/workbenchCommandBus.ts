import { EventsEmit } from '../../wailsjs/runtime/runtime'
import { useAppStore } from '../stores/appStore'
import { UI_CAPABILITIES } from './capabilities'
import { capabilityToProductId } from './routing'

export type CommandSource =
  | 'user'
  | 'notebook'
  | 'docker'
  | 'database'
  | 'terminal'
  | 'sftp'
  | 'logs'
  | 'httpapi'
  | 'agent'
  | 'backup'

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
/** 工作台尚未挂载时的排队命令。 */
const pendingByCapability = new Map<string, WorkbenchCommand[]>()
/**
 * UI 打开类命令的粘性副本：覆盖「先切产品再挂载」与 React StrictMode 双挂载。
 * 成功处理后清除；新命令覆盖旧粘性。
 */
const stickyUIOpen = new Map<string, WorkbenchCommand>()

function clearStickyIfSame(capability: string, cmdId: string) {
  if (stickyUIOpen.get(capability)?.id === cmdId) {
    stickyUIOpen.delete(capability)
  }
}

/** registerWorkbenchHandler 注册某能力的处理器（工作台挂载时调用）。 */
export function registerWorkbenchHandler(capability: string, fn: CommandHandler): () => void {
  let set = handlers.get(capability)
  if (!set) {
    set = new Set()
    handlers.set(capability, set)
  }
  set.add(fn)

  const queued = pendingByCapability.get(capability) ?? []
  if (queued.length) pendingByCapability.delete(capability)
  const sticky = stickyUIOpen.get(capability)
  const seen = new Set<string>()
  const toDeliver: WorkbenchCommand[] = []
  // 粘性优先（最新一次打开意图）
  if (sticky) {
    toDeliver.push(sticky)
    seen.add(sticky.id)
  }
  for (const cmd of queued) {
    if (seen.has(cmd.id)) continue
    toDeliver.push(cmd)
    seen.add(cmd.id)
  }
  for (const cmd of toDeliver) {
    void runHandler(capability, cmd, fn)
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

/** activateProductForCapability 切换到目标产品线并触发懒挂载。 */
function activateProductForCapability(capability: string) {
  const product = capabilityToProductId(capability)
  if (product) useAppStore.getState().setActiveProduct(product)
}

async function runHandler(capability: string, cmd: WorkbenchCommand, fn: CommandHandler) {
  try {
    await fn(cmd)
    reportCommandResult(cmd.id, { ok: true }, capability)
    // 仍有处理器挂着时才清粘性，避免 StrictMode 卸挂瞬间把意图清掉
    if ((handlers.get(capability)?.size ?? 0) > 0) {
      clearStickyIfSame(capability, cmd.id)
    }
  } catch (e) {
    reportCommandResult(cmd.id, { ok: false, error: (e as Error).message }, capability)
  }
}

/** dispatchWorkbenchCommand 分发工作台命令。 */
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
    stickyUIOpen.set(cmd.capability, cmd)
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

/** openCapability 跨产品打开/联动的唯一入口（直接 capability，无 action 别名）。 */
export function openCapability(
  capability: string,
  payload: Record<string, unknown> = {},
  source: CommandSource = 'user',
) {
  void dispatchWorkbenchCommand({ capability, source, payload })
}

import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { useAppStore } from '../../stores/appStore'
import { dispatchWorkbenchCommand } from '../../workbench/workbenchCommandBus'
import { Capability } from '../../workbench/capabilities'

/** dispatchAgentUiAction 执行 Agent 触发的 UI 联动（走 CommandBus）。 */
export function dispatchAgentUiAction(raw: Record<string, unknown>) {
  const kind = String(raw.kind ?? '')
  if (!kind) return

  const payload = { ...raw }
  delete payload.kind

  void dispatchWorkbenchCommand({
    capability: kind,
    source: 'agent',
    payload,
  }).then((res) => {
    if (res.ok) {
      if (kind === Capability.TerminalOpen) {
        useAppStore.getState().setStatusMessage(
          payload.localShell ? 'AI：已打开本机终端' : 'AI：已打开 SSH 终端',
        )
      } else if (kind === Capability.DatabaseOpen) {
        useAppStore.getState().setStatusMessage('AI：已打开数据库工作台')
      }
    } else if (res.error) {
      useAppStore.getState().setStatusMessage(res.error)
    }
  })
}

/** subscribeAgentUiActions 订阅 agent:ui_action。 */
export function subscribeAgentUiActions() {
  return EventsOn('agent:ui_action', (raw: Record<string, unknown>) => {
    dispatchAgentUiAction(raw)
  })
}

/** subscribeCommandResults 订阅命令执行结果。 */
export function subscribeCommandResults(onResult: (raw: Record<string, unknown>) => void) {
  return EventsOn('workbench:command:result', onResult)
}

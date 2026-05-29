import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface TerminalOutputEvent {
  sessionId: string
  data: string
}

/** parseTerminalEvent 解析 Wails 终端事件载荷。 */
function parseTerminalEvent(raw: unknown): TerminalOutputEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const sessionId = (e.sessionId ?? e.sessionID) as string | undefined
  const data = e.data as string | undefined
  if (!sessionId) return null
  return { sessionId, data: data ?? '' }
}

/** onTerminalOutput 订阅终端输出。 */
export function onTerminalOutput(handler: (event: TerminalOutputEvent) => void): () => void {
  return EventsOn('terminal:output', (...args: unknown[]) => {
    const evt = parseTerminalEvent(args[0])
    if (evt) handler(evt)
  })
}

/** onTerminalClosed 订阅终端关闭。 */
export function onTerminalClosed(handler: (sessionId: string) => void): () => void {
  return EventsOn('terminal:closed', (...args: unknown[]) => {
    const evt = parseTerminalEvent(args[0])
    if (evt) handler(evt.sessionId)
  })
}

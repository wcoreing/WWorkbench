import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface AgentAssistantEvent {
  threadId: string
  content: string
  seq?: number
}

export interface AgentToolEvent {
  threadId: string
  tool: string
  args?: string
  result?: unknown
  status?: string
  summary?: string
}

export interface AgentConfirmEvent {
  threadId: string
  pendingId: string
  tool: string
  summary: string
  preview?: unknown
}

export interface AgentDoneEvent {
  threadId: string
  error?: string
  waitingConfirm?: boolean
  stopped?: boolean
}

export interface AgentUserEvent {
  threadId: string
  content: string
  mentions: unknown
  seq?: number
}

function optionalSeq(raw: Record<string, unknown>): number | undefined {
  const v = raw.seq
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/** subscribeAgentEvents 订阅 Agent 运行时事件。 */
export function subscribeAgentEvents(handlers: {
  onUser?: (evt: AgentUserEvent) => void
  onAssistant?: (evt: AgentAssistantEvent) => void
  onAssistantDelta?: (threadId: string, delta: string) => void
  onToolStart?: (evt: AgentToolEvent) => void
  onToolEnd?: (evt: AgentToolEvent) => void
  onNeedsConfirm?: (evt: AgentConfirmEvent) => void
  onDone?: (evt: AgentDoneEvent) => void
}) {
  const unsubs: Array<() => void> = []
  if (handlers.onUser) {
    unsubs.push(
      EventsOn('agent:user', (raw: Record<string, unknown>) => {
        handlers.onUser!({
          threadId: String(raw.threadId ?? ''),
          content: String(raw.content ?? ''),
          mentions: raw.mentions,
          seq: optionalSeq(raw),
        })
      }),
    )
  }
  if (handlers.onAssistant) {
    unsubs.push(
      EventsOn('agent:assistant', (raw: Record<string, unknown>) => {
        handlers.onAssistant!({
          threadId: String(raw.threadId ?? ''),
          content: String(raw.content ?? ''),
          seq: optionalSeq(raw),
        })
      }),
    )
  }
  if (handlers.onAssistantDelta) {
    unsubs.push(
      EventsOn('agent:assistant_delta', (raw: Record<string, unknown>) => {
        handlers.onAssistantDelta!(
          String(raw.threadId ?? ''),
          String(raw.delta ?? ''),
        )
      }),
    )
  }
  if (handlers.onToolStart) {
    unsubs.push(
      EventsOn('agent:tool_start', (raw: Record<string, unknown>) => {
        handlers.onToolStart!({
          threadId: String(raw.threadId ?? ''),
          tool: String(raw.tool ?? ''),
          args: String(raw.args ?? ''),
        })
      }),
    )
  }
  if (handlers.onToolEnd) {
    unsubs.push(
      EventsOn('agent:tool_end', (raw: Record<string, unknown>) => {
        handlers.onToolEnd!({
          threadId: String(raw.threadId ?? ''),
          tool: String(raw.tool ?? ''),
          result: raw.result,
          status: raw.status ? String(raw.status) : undefined,
          summary: raw.summary ? String(raw.summary) : undefined,
        })
      }),
    )
  }
  if (handlers.onNeedsConfirm) {
    unsubs.push(
      EventsOn('agent:needs_confirm', (raw: Record<string, unknown>) => {
        handlers.onNeedsConfirm!({
          threadId: String(raw.threadId ?? ''),
          pendingId: String(raw.pendingId ?? ''),
          tool: String(raw.tool ?? ''),
          summary: String(raw.summary ?? ''),
          preview: raw.preview,
        })
      }),
    )
  }
  if (handlers.onDone) {
    unsubs.push(
      EventsOn('agent:done', (raw: Record<string, unknown>) => {
        handlers.onDone!({
          threadId: String(raw.threadId ?? ''),
          error: raw.error ? String(raw.error) : undefined,
          waitingConfirm: Boolean(raw.waitingConfirm),
          stopped: Boolean(raw.stopped),
        })
      }),
    )
  }
  return () => {
    for (const u of unsubs) u()
  }
}

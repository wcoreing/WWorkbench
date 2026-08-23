import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface AgentAssistantEvent {
  threadId: string
  content: string
  skillIds?: string[]
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

export interface AgentConfirmItem {
  pendingId: string
  tool: string
  summary: string
  preview?: unknown
}

export interface AgentConfirmEvent {
  threadId: string
  pendingId: string
  tool: string
  summary: string
  preview?: unknown
  items?: AgentConfirmItem[]
}

export interface AgentDoneEvent {
  threadId: string
  error?: string
  waitingConfirm?: boolean
  waitingChoice?: boolean
  stopped?: boolean
}

export interface AgentOfferChoiceOption {
  key: string
  label: string
}

export interface AgentOfferChoiceItem {
  pendingId: string
  n: number
  prompt: string
  mode: 'single' | 'multi' | 'text'
  options?: AgentOfferChoiceOption[]
  placeholder?: string
  summary?: string
}

export interface AgentOfferChoicesEvent {
  threadId: string
  pendingId: string
  summary?: string
  items: AgentOfferChoiceItem[]
}

export interface AgentUserEvent {
  threadId: string
  content: string
  mentions: unknown
  images?: { mime: string; data: string }[]
  skillIds?: string[]
  seq?: number
}

function parseEventImages(raw: unknown): { mime: string; data: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: { mime: string; data: string }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const mime = String(rec.mime ?? '')
    const data = String(rec.data ?? '')
    if (mime && data) out.push({ mime, data })
  }
  return out.length ? out : undefined
}

function parseEventSkillIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map((v) => String(v ?? '').trim()).filter(Boolean)
  return out.length ? out : undefined
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
  onOfferChoices?: (evt: AgentOfferChoicesEvent) => void
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
          images: parseEventImages(raw.images),
          skillIds: parseEventSkillIds(raw.skillIds),
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
          skillIds: parseEventSkillIds(raw.skillIds),
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
        const itemsRaw = raw.items
        let items: AgentConfirmItem[] | undefined
        if (Array.isArray(itemsRaw)) {
          const parsed: AgentConfirmItem[] = []
          for (const row of itemsRaw) {
            if (!row || typeof row !== 'object') continue
            const rec = row as Record<string, unknown>
            const pendingId = String(rec.pendingId ?? '').trim()
            if (!pendingId) continue
            parsed.push({
              pendingId,
              tool: String(rec.tool ?? ''),
              summary: String(rec.summary ?? ''),
              preview: rec.preview,
            })
          }
          items = parsed.length > 0 ? parsed : undefined
        }
        handlers.onNeedsConfirm!({
          threadId: String(raw.threadId ?? ''),
          pendingId: String(raw.pendingId ?? ''),
          tool: String(raw.tool ?? ''),
          summary: String(raw.summary ?? ''),
          preview: raw.preview,
          items,
        })
      }),
    )
  }
  if (handlers.onOfferChoices) {
    unsubs.push(
      EventsOn('agent:offer_choices', (raw: Record<string, unknown>) => {
        const itemsRaw = raw.items
        const items: AgentOfferChoiceItem[] = []
        if (Array.isArray(itemsRaw)) {
          for (const row of itemsRaw) {
            if (!row || typeof row !== 'object') continue
            const rec = row as Record<string, unknown>
            const pendingId = String(rec.pendingId ?? '').trim()
            if (!pendingId) continue
            const modeRaw = String(rec.mode ?? 'single').toLowerCase()
            const mode =
              modeRaw === 'multi' || modeRaw === 'text' ? modeRaw : 'single'
            const optsRaw = rec.options
            const options: AgentOfferChoiceOption[] = []
            if (Array.isArray(optsRaw)) {
              for (const o of optsRaw) {
                if (!o || typeof o !== 'object') continue
                const or = o as Record<string, unknown>
                const key = String(or.key ?? '').trim()
                const label = String(or.label ?? '').trim()
                if (key && label) options.push({ key, label })
              }
            }
            const n = Number(rec.n)
            items.push({
              pendingId,
              n: Number.isFinite(n) && n > 0 ? n : items.length + 1,
              prompt: String(rec.prompt ?? rec.summary ?? ''),
              mode,
              options,
              placeholder: rec.placeholder ? String(rec.placeholder) : undefined,
              summary: rec.summary ? String(rec.summary) : undefined,
            })
          }
        }
        handlers.onOfferChoices!({
          threadId: String(raw.threadId ?? ''),
          pendingId: String(raw.pendingId ?? ''),
          summary: raw.summary ? String(raw.summary) : undefined,
          items,
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
          waitingChoice: Boolean(raw.waitingChoice),
          stopped: Boolean(raw.stopped),
        })
      }),
    )
  }
  return () => {
    for (const u of unsubs) u()
  }
}

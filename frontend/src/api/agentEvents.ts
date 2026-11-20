import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface AgentAssistantEvent {
  threadId: string
  content: string
  skillIds?: string[]
  seq?: number
}

export interface AgentTeachPayload {
  summary?: string
  nextSteps?: string[]
  highlights?: string[]
  raw?: string
}

export interface AgentSuggestedSkillPayload {
  name?: string
  lessons?: string
  askHuman?: boolean
  offerPrompt?: string
  domain?: string
}

export interface AgentToolEvent {
  threadId: string
  tool: string
  callId?: string
  args?: string
  result?: unknown
  status?: string
  summary?: string
  images?: { mime: string; data: string }[]
  teach?: AgentTeachPayload
  suggestedSkill?: AgentSuggestedSkillPayload
}

export interface AgentDoneEvent {
  threadId: string
  error?: string
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

function parseTeach(raw: unknown): AgentTeachPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const summary = String(rec.summary ?? '').trim()
  const nextSteps = Array.isArray(rec.nextSteps)
    ? rec.nextSteps.map((v) => String(v ?? '').trim()).filter(Boolean)
    : undefined
  const highlights = Array.isArray(rec.highlights)
    ? rec.highlights.map((v) => String(v ?? '').trim()).filter(Boolean)
    : undefined
  const rawText = String(rec.raw ?? '').trim()
  if (!summary && !(nextSteps && nextSteps.length) && !(highlights && highlights.length)) return undefined
  return {
    summary: summary || undefined,
    nextSteps: nextSteps?.length ? nextSteps : undefined,
    highlights: highlights?.length ? highlights : undefined,
    raw: rawText || undefined,
  }
}

function parseSuggestedSkill(raw: unknown): AgentSuggestedSkillPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const name = String(rec.name ?? '').trim()
  if (!name) return undefined
  return {
    name,
    lessons: String(rec.lessons ?? '').trim() || undefined,
    askHuman: rec.askHuman !== false,
    offerPrompt: String(rec.offerPrompt ?? '').trim() || undefined,
    domain: String(rec.domain ?? '').trim() || undefined,
  }
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

/** 把 Wails 同步回调甩到下一 macrotask，避免工具/流式期间堵死输入与滚动。 */
function deferUI(fn: () => void) {
  window.setTimeout(fn, 0)
}

/** subscribeAgentEvents 订阅 Agent 运行时事件。 */
export function subscribeAgentEvents(handlers: {
  onUser?: (evt: AgentUserEvent) => void
  onAssistant?: (evt: AgentAssistantEvent) => void
  onAssistantDelta?: (threadId: string, delta: string) => void
  onToolStart?: (evt: AgentToolEvent) => void
  onToolEnd?: (evt: AgentToolEvent) => void
  onOfferChoices?: (evt: AgentOfferChoicesEvent) => void
  onDone?: (evt: AgentDoneEvent) => void
}) {
  const unsubs: Array<() => void> = []
  if (handlers.onUser) {
    unsubs.push(
      EventsOn('agent:user', (raw: Record<string, unknown>) => {
        deferUI(() =>
          handlers.onUser!({
            threadId: String(raw.threadId ?? ''),
            content: String(raw.content ?? ''),
            mentions: raw.mentions,
            images: parseEventImages(raw.images),
            skillIds: parseEventSkillIds(raw.skillIds),
            seq: optionalSeq(raw),
          }),
        )
      }),
    )
  }
  if (handlers.onAssistant) {
    unsubs.push(
      EventsOn('agent:assistant', (raw: Record<string, unknown>) => {
        deferUI(() =>
          handlers.onAssistant!({
            threadId: String(raw.threadId ?? ''),
            content: String(raw.content ?? ''),
            skillIds: parseEventSkillIds(raw.skillIds),
            seq: optionalSeq(raw),
          }),
        )
      }),
    )
  }
  if (handlers.onAssistantDelta) {
    unsubs.push(
      EventsOn('agent:assistant_delta', (raw: Record<string, unknown>) => {
        // 不 setTimeout：store 内 rAF 合并即可，避免堆积大量定时器
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
        deferUI(() =>
          handlers.onToolStart!({
            threadId: String(raw.threadId ?? ''),
            tool: String(raw.tool ?? ''),
            callId: raw.callId ? String(raw.callId) : undefined,
            args: String(raw.args ?? ''),
          }),
        )
      }),
    )
  }
  if (handlers.onToolEnd) {
    unsubs.push(
      EventsOn('agent:tool_end', (raw: Record<string, unknown>) => {
        deferUI(() =>
          handlers.onToolEnd!({
            threadId: String(raw.threadId ?? ''),
            tool: String(raw.tool ?? ''),
            callId: raw.callId ? String(raw.callId) : undefined,
            result: raw.result,
            status: raw.status ? String(raw.status) : undefined,
            summary: raw.summary ? String(raw.summary) : undefined,
            images: parseEventImages(raw.images),
            teach: parseTeach(raw.teach),
            suggestedSkill: parseSuggestedSkill(raw.suggestedSkill),
          }),
        )
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
        deferUI(() =>
          handlers.onOfferChoices!({
            threadId: String(raw.threadId ?? ''),
            pendingId: String(raw.pendingId ?? ''),
            summary: raw.summary ? String(raw.summary) : undefined,
            items,
          }),
        )
      }),
    )
  }
  if (handlers.onDone) {
    unsubs.push(
      EventsOn('agent:done', (raw: Record<string, unknown>) => {
        deferUI(() =>
          handlers.onDone!({
            threadId: String(raw.threadId ?? ''),
            error: raw.error ? String(raw.error) : undefined,
            waitingChoice: Boolean(raw.waitingChoice),
            stopped: Boolean(raw.stopped),
          }),
        )
      }),
    )
  }
  return () => {
    for (const u of unsubs) u()
  }
}

/**
 * Agent 可选表单：回复里挂 ```agent-choice / ```desk-choice，侧栏渲成可点选项。
 * 点选后发送选项 label 原文（与 AgentDesk desk-choice 同构）。
 */

export type AgentChoiceOption = {
  key: string
  label: string
}

export type AgentChoiceMode = 'single' | 'multi' | 'text'

export type AgentChoiceQuestion = {
  n: number
  id?: string
  mode: AgentChoiceMode
  prompt: string
  options: AgentChoiceOption[]
  placeholder?: string
}

export type AgentChoiceParse = {
  body: string
  questions: AgentChoiceQuestion[]
}

const FENCE_RE = /```\s*(?:agent-choice|desk-choice)\s*\r?\n([\s\S]*?)```/gi

type RawOption = { key?: unknown; label?: unknown }
type RawQuestion = {
  n?: unknown
  id?: unknown
  mode?: unknown
  prompt?: unknown
  question?: unknown
  options?: unknown
  placeholder?: unknown
  questions?: unknown
}

function normKey(k: string): string {
  return k.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseOptions(raw: unknown): AgentChoiceOption[] {
  if (!Array.isArray(raw)) return []
  const out: AgentChoiceOption[] = []
  for (const item of raw as RawOption[]) {
    if (!item || typeof item !== 'object') continue
    const key = normKey(String(item.key ?? ''))
    const label = String(item.label ?? '').trim()
    if (!key || !label) continue
    out.push({ key, label })
  }
  return out
}

function parseMode(raw: unknown): AgentChoiceMode {
  const m = String(raw ?? 'single')
    .trim()
    .toLowerCase()
  if (m === 'multi' || m === 'multiple') return 'multi'
  if (m === 'text' || m === 'input' || m === 'fill') return 'text'
  return 'single'
}

function normalizeQuestion(raw: RawQuestion, fallbackN: number): AgentChoiceQuestion | null {
  const prompt = String(raw.prompt ?? raw.question ?? '').trim()
  if (!prompt) return null
  const mode = parseMode(raw.mode)
  const options = mode === 'text' ? [] : parseOptions(raw.options)
  if (mode !== 'text' && !options.length) return null
  let n = Number(raw.n)
  if (!Number.isFinite(n) || n < 1) n = fallbackN
  n = Math.floor(n)
  const id = String(raw.id ?? '').trim() || undefined
  const placeholder = String(raw.placeholder ?? '').trim() || undefined
  return { n, id, mode, prompt, options, placeholder }
}

function questionsFromJSON(text: string, startN: number): AgentChoiceQuestion[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  let data: RawQuestion
  try {
    data = JSON.parse(trimmed) as RawQuestion
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []

  if (Array.isArray(data.questions)) {
    const out: AgentChoiceQuestion[] = []
    let next = startN
    for (const item of data.questions as RawQuestion[]) {
      if (!item || typeof item !== 'object') continue
      const q = normalizeQuestion(item, next)
      if (!q) continue
      out.push(q)
      next = Math.max(next, q.n) + 1
    }
    return out
  }

  const q = normalizeQuestion(data, startN)
  return q ? [q] : []
}

/** 从助手正文抽出 agent-choice / 「可选下一步」列表。 */
export function extractAgentChoices(content: string): AgentChoiceParse {
  const src = content || ''
  const questions: AgentChoiceQuestion[] = []
  let nextN = 1
  let body = src.replace(FENCE_RE, (_full, inner: string) => {
    const qs = questionsFromJSON(inner, nextN)
    for (const q of qs) {
      questions.push(q)
      nextN = Math.max(nextN, q.n) + 1
    }
    return '\n'
  })
  if (!questions.length) {
    const fallback = extractNextStepsFromMarkdown(body)
    if (fallback.question) {
      questions.push(fallback.question)
      body = fallback.body
    }
  }
  questions.sort((a, b) => a.n - b.n)
  return { body: body.replace(/\n{3,}/g, '\n\n').trim(), questions }
}

const NEXT_STEPS_HEADER =
  /(?:^|\n)(?:#{1,3}\s*)?(?:\*\*)?(?:可选下一步|Next steps?)(?:\*\*)?\s*[：:]?\s*(?:\n|$)/i

function extractNextStepsFromMarkdown(body: string): {
  question: AgentChoiceQuestion | null
  body: string
} {
  const m = body.match(NEXT_STEPS_HEADER)
  if (!m || m.index === undefined) return { question: null, body }
  const start = m.index + m[0].length
  const tail = body.slice(start)
  const labels = parseListLabels(tail)
  if (labels.length < 2 || labels.length > 8) return { question: null, body }
  const keys = 'abcdefghijklmnopqrstuvwxyz'
  const options: AgentChoiceOption[] = labels.map((label, i) => ({
    key: keys[i] || String(i + 1),
    label,
  }))
  const end = start + consumedListChars(tail, labels.length)
  const stripped = (body.slice(0, m.index) + body.slice(end)).replace(/\n{3,}/g, '\n\n').trim()
  return {
    question: {
      n: 1,
      id: 'next-steps',
      mode: 'single',
      prompt: '可选下一步',
      options,
    },
    body: stripped,
  }
}

function parseListLabels(block: string): string[] {
  const labels: string[] = []
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (labels.length) break
      continue
    }
    const item = trimmed.match(/^(?:[-*+]|\d+[.)、])\s*(.+)$/)
    if (!item) {
      if (labels.length) break
      continue
    }
    const label = item[1].replace(/\*\*/g, '').trim()
    if (label) labels.push(label)
  }
  return labels
}

function consumedListChars(block: string, count: number): number {
  let seen = 0
  let pos = 0
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (seen) {
        pos += line.length + 1
        break
      }
      pos += line.length + 1
      continue
    }
    const item = trimmed.match(/^(?:[-*+]|\d+[.)、])\s*(.+)$/)
    if (!item) {
      if (seen) break
      pos += line.length + 1
      continue
    }
    seen++
    pos += line.length + 1
    if (seen >= count) break
  }
  return pos
}

export type ChoiceAnswer = { keys?: string[]; text?: string }

/** 单选/多选/填空 → 发送给 Agent 的原文（选项 label / 填空内容）。 */
export function formatChoiceSendText(q: AgentChoiceQuestion, answer: ChoiceAnswer): string {
  if (q.mode === 'text') {
    return (answer.text || '').trim()
  }
  const keys = (answer.keys || []).map(normKey).filter(Boolean)
  if (!keys.length) return ''
  const labels: string[] = []
  for (const k of keys) {
    const opt = q.options.find((o) => o.key === k)
    const label = (opt?.label || '').trim()
    if (label) labels.push(label)
  }
  if (!labels.length) return ''
  return q.mode === 'multi' ? labels.join('、') : labels[0]
}

/** 多题原文合并（每行一题）。 */
export function joinChoiceSendTexts(
  questions: AgentChoiceQuestion[],
  answers: Record<number, ChoiceAnswer>,
): string {
  const lines: string[] = []
  for (const q of questions) {
    const a = answers[q.n]
    if (!a) continue
    const t = formatChoiceSendText(q, a)
    if (t) lines.push(t)
  }
  return lines.join('\n')
}

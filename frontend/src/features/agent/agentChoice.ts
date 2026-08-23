/**
 * Agent 可选表单：优先由工具 offer_choices 驱动（点选后续跑）；
 * 回复里 ```agent-choice / ```desk-choice 与 Markdown 列表为兜底（点选写入输入框）。
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

/** 显式标记；模型常误写成 json / 空 lang，形似选项表时一并抽出。 */
const FENCE_RE = /```\s*([a-zA-Z0-9_-]*)\s*\r?\n([\s\S]*?)```/gi

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

function isChoiceFenceLang(lang: string): boolean {
  const t = lang.trim().toLowerCase()
  return (
    t === 'agent-choice' ||
    t === 'agentchoice' ||
    t === 'desk-choice' ||
    t === 'deskchoice' ||
    t === 'json' ||
    t === ''
  )
}

/** 从助手正文抽出 agent-choice / 「可选下一步」列表。 */
export function extractAgentChoices(content: string): AgentChoiceParse {
  const src = content || ''
  const questions: AgentChoiceQuestion[] = []
  let nextN = 1
  let body = src.replace(FENCE_RE, (full, lang: string, inner: string) => {
    if (!isChoiceFenceLang(lang || '')) return full
    const qs = questionsFromJSON(inner, nextN)
    if (!qs.length) return full
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
  /(?:^|\n)(?:#{1,3}\s*)?(?:\*\*)?(?:可选下一步|Next steps?|需要的话我可以继续|我可以继续(?:帮你|为你)?|接下来(?:我)?可以|你可以选择|可选操作|还可以(?:继续|做)|要不要我)(?:\*\*)?\s*[：:]?\s*(?:\n|$)/i

/** Agent 只写 Markdown 列表、未挂 agent-choice 时，从「可选下一步 / 需要的话我可以继续」等段落成表单。 */
function extractNextStepsFromMarkdown(body: string): {
  question: AgentChoiceQuestion | null
  body: string
} {
  const fromHeader = extractListAfterHeader(body, NEXT_STEPS_HEADER)
  if (fromHeader.question) return fromHeader
  // 兜底：末尾「……：\n- a\n- b」+ 可选收尾问句
  return extractTrailingOfferList(body)
}

function extractListAfterHeader(
  body: string,
  headerRe: RegExp,
): { question: AgentChoiceQuestion | null; body: string } {
  const m = body.match(headerRe)
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
  const prompt = m[0]
    .replace(/^\n/, '')
    .replace(/^#{1,3}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/[：:]\s*$/, '')
    .trim() || '可选下一步'
  const stripped = (body.slice(0, m.index) + body.slice(end)).replace(/\n{3,}/g, '\n\n').trim()
  return {
    question: {
      n: 1,
      id: 'next-steps',
      mode: 'single',
      prompt,
      options,
    },
    body: stripped,
  }
}

/** 正文末尾「引导句：」+ 2～8 条列表（常见于模型未写 agent-choice）。 */
function extractTrailingOfferList(body: string): {
  question: AgentChoiceQuestion | null
  body: string
} {
  const lines = body.split('\n')
  // 从末尾跳过空行与收尾短问句
  let i = lines.length - 1
  while (i >= 0 && !lines[i].trim()) i--
  if (i < 0) return { question: null, body }
  const closing = lines[i].trim()
  let listEnd = i
  if (/[？?]$/.test(closing) && closing.length <= 40 && !/^(?:[-*+]|\d+[.)、])\s/.test(closing)) {
    listEnd = i - 1
    while (listEnd >= 0 && !lines[listEnd].trim()) listEnd--
  }
  if (listEnd < 0) return { question: null, body }

  const labels: string[] = []
  let j = listEnd
  while (j >= 0) {
    const trimmed = lines[j].trim()
    if (!trimmed) break
    const item = trimmed.match(/^(?:[-*+]|\d+[.)、])\s*(.+)$/)
    if (!item) break
    labels.unshift(item[1].replace(/\*\*/g, '').trim())
    j--
  }
  if (labels.length < 2 || labels.length > 8) return { question: null, body }
  while (j >= 0 && !lines[j].trim()) j--
  if (j < 0) return { question: null, body }
  const head = lines[j].trim().replace(/\*\*/g, '')
  if (!/[：:]$/.test(head) || head.length > 48) return { question: null, body }
  if (!/(继续|选择|下一步|可以|要不要|可选|接着)/.test(head)) return { question: null, body }

  const keys = 'abcdefghijklmnopqrstuvwxyz'
  const options: AgentChoiceOption[] = labels.map((label, idx) => ({
    key: keys[idx] || String(idx + 1),
    label,
  }))
  const prompt = head.replace(/[：:]\s*$/, '').trim() || '可选下一步'
  const stripped = lines.slice(0, j).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // 保留收尾问句（若有）
  const keepTail =
    listEnd < i ? '\n\n' + lines.slice(listEnd + 1).join('\n').trim() : ''
  return {
    question: {
      n: 1,
      id: 'next-steps',
      mode: 'single',
      prompt,
      options,
    },
    body: (stripped + keepTail).replace(/\n{3,}/g, '\n\n').trim(),
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

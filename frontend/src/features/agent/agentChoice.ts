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

/** 从助手正文抽出 agent-choice；无围栏时按 Markdown 列表格式兜底（不看文案语义）。 */
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
    const fallback = extractLastMarkdownList(body)
    if (fallback.question) {
      questions.push(fallback.question)
      body = fallback.body
    }
  }
  questions.sort((a, b) => a.n - b.n)
  return { body: body.replace(/\n{3,}/g, '\n\n').trim(), questions }
}

const LIST_ITEM_RE = /^(?:[-*+]|\d+[.)、])\s+(.+)$/

/** 掩码代码围栏，避免把 fence 内列表当成选项。 */
function maskCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
}

type ListBlock = {
  startLine: number
  endLine: number
  labels: string[]
}

/** 扫描正文中连续 Markdown 列表块（无序列表 / 有序列表）。 */
function findMarkdownListBlocks(lines: string[]): ListBlock[] {
  const blocks: ListBlock[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed || !LIST_ITEM_RE.test(trimmed)) {
      i++
      continue
    }
    const start = i
    const labels: string[] = []
    while (i < lines.length) {
      const line = lines[i].trim()
      if (!line) break
      const item = line.match(LIST_ITEM_RE)
      if (!item) break
      const label = item[1].replace(/\*\*/g, '').trim()
      if (label) labels.push(label)
      i++
    }
    if (labels.length >= 2 && labels.length <= 8) {
      blocks.push({ startLine: start, endLine: i - 1, labels })
    }
  }
  return blocks
}

/**
 * 按 Markdown 列表格式抽出可点选项：取正文中最后一段 2～8 项列表。
 * 列表上一行短文案作 prompt（可选）；列表后的正文保留。
 */
function extractLastMarkdownList(body: string): {
  question: AgentChoiceQuestion | null
  body: string
} {
  const masked = maskCodeFences(body)
  const lines = body.split('\n')
  const maskedLines = masked.split('\n')
  // 用掩码后的行找列表位置，标签仍取原文
  const blocks = findMarkdownListBlocks(maskedLines)
  if (!blocks.length) return { question: null, body }

  const block = blocks[blocks.length - 1]
  const labels = lines
    .slice(block.startLine, block.endLine + 1)
    .map((line) => {
      const item = line.trim().match(LIST_ITEM_RE)
      return item ? item[1].replace(/\*\*/g, '').trim() : ''
    })
    .filter(Boolean)
  if (labels.length < 2 || labels.length > 8) return { question: null, body }

  let promptLine = -1
  for (let j = block.startLine - 1; j >= 0; j--) {
    if (!lines[j].trim()) continue
    if (LIST_ITEM_RE.test(lines[j].trim())) break
    promptLine = j
    break
  }

  const keys = 'abcdefghijklmnopqrstuvwxyz'
  const options: AgentChoiceOption[] = labels.map((label, idx) => ({
    key: keys[idx] || String(idx + 1),
    label,
  }))
  const prompt =
    promptLine >= 0
      ? lines[promptLine]
          .trim()
          .replace(/\*\*/g, '')
          .replace(/[：:]\s*$/, '')
          .trim()
      : '请选择'

  const keepHead = lines.slice(0, promptLine >= 0 ? promptLine : block.startLine).join('\n')
  const keepTail = lines.slice(block.endLine + 1).join('\n')
  const stripped = [keepHead, keepTail]
    .map((s) => s.replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .join('\n\n')

  return {
    question: {
      n: 1,
      id: 'md-list',
      mode: 'single',
      prompt: prompt || '请选择',
      options,
    },
    body: stripped,
  }
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

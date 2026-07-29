/** tryFormatJson 尝试解析 JSON；成功返回格式化文本与展开后的值（嵌套 JSON 字符串一并展开）。 */
export function tryFormatJson(
  raw: string,
): { ok: true; formatted: string; value: unknown } | { ok: false } {
  const text = raw.trim()
  if (!text) return { ok: false }
  const first = text[0]
  if (first !== '{' && first !== '[' && first !== '"') return { ok: false }
  try {
    const parsed = JSON.parse(text) as unknown
    const expanded = deepExpandJson(parsed)
    return { ok: true, formatted: JSON.stringify(expanded, null, 2), value: expanded }
  } catch {
    return { ok: false }
  }
}

/**
 * deepExpandJson 递归展开对象/数组中「值为 JSON 文本」的字符串字段。
 * 仅当字符串可解析为 object/array（或经多层解码后成为 object/array）时才替换，避免把普通数字/布尔字符串改掉。
 */
function deepExpandJson(value: unknown, depth = 0): unknown {
  if (depth > 32) return value
  if (typeof value === 'string') {
    const nested = expandJsonText(value, depth)
    return nested !== undefined ? nested : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepExpandJson(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepExpandJson(child, depth + 1)
    }
    return out
  }
  return value
}

/** expandJsonText 把可能多层转义的 JSON 文本解到 object/array；解不出则返回 undefined。 */
function expandJsonText(raw: string, depth: number): unknown | undefined {
  let current: unknown = raw
  for (let i = 0; i < 8; i++) {
    if (typeof current !== 'string') break
    const text = current.trim()
    if (!text) return undefined
    const ch = text[0]
    if (ch !== '{' && ch !== '[' && ch !== '"') return undefined
    try {
      current = JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  }
  if (current !== null && typeof current === 'object') {
    return deepExpandJson(current, depth + 1)
  }
  return undefined
}

/** looksLikeMarkdown 启发式判断文本是否像 Markdown。 */
export function looksLikeMarkdown(text: string): boolean {
  const t = normalizeMarkdownSource(text).trim()
  if (!t || t.length < 3) return false
  if (/^#{1,6}\s+\S/m.test(t)) return true
  if (/```[\s\S]*```/.test(t)) return true
  if (/^\s{0,3}[-*+]\s+\S/m.test(t)) return true
  if (/^\s{0,3}\d+\.\s+\S/m.test(t)) return true
  if (/^\s{0,3}>\s+\S/m.test(t)) return true
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return true
  if (/\*\*[^*\n]+\*\*/.test(t) || /__[^_\n]+__/.test(t)) return true
  if (/\|.+\|/.test(t) && /^\s*\|?\s*-{3,}/m.test(t)) return true
  // 长文本里大量加粗/标题标记，也按 Markdown 处理
  if (t.length > 80 && ((t.match(/\*\*/g) || []).length >= 4 || (t.match(/^#{1,6}\s/gm) || []).length >= 1)) {
    return true
  }
  return false
}

/**
 * normalizeMarkdownSource 还原误存成字面量的 \\n / \\t，便于识别与渲染。
 * 仅当转义序列明显多于真实换行时处理，避免误伤正常反斜杠文本。
 */
export function normalizeMarkdownSource(text: string): string {
  const realNewlines = (text.match(/\n/g) || []).length
  const escapedNewlines = (text.match(/\\n/g) || []).length
  if (escapedNewlines >= 2 && escapedNewlines > realNewlines) {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
  }
  return text
}

/** containsMarkdown 判断值树中是否存在像 Markdown 的字符串。 */
export function containsMarkdown(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (typeof value === 'string') return looksLikeMarkdown(value)
  if (Array.isArray(value)) return value.some((item) => containsMarkdown(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((child) =>
      containsMarkdown(child, depth + 1),
    )
  }
  return false
}

/** isLikelyLargeCell 判断是否适合用弹窗浏览（长文本 / 多行 / JSON）。 */
export function isLikelyLargeCell(text: string | null | undefined): boolean {
  if (text == null || text === '') return false
  if (text.length > 64) return true
  if (text.includes('\n')) return true
  const t = text.trim()
  return (t.startsWith('{') || t.startsWith('[')) && t.length > 2
}

/** cellStats 粗略字符/行数统计。 */
export function cellStats(text: string): { chars: number; lines: number } {
  return {
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
  }
}

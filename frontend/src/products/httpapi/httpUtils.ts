import type { HTTPHeaderKV } from '../../api/types'

export type HttpKVRow = { key: string; value: string; enabled: boolean }

export type HttpBodyMode = 'none' | 'json' | 'xml' | 'raw' | 'form'

export type HttpAuthMode = 'none' | 'bearer'

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** emptyKVRow 返回空键值行。 */
export function emptyKVRow(): HttpKVRow {
  return { key: '', value: '', enabled: true }
}

/** nextUntitledHttpName 生成不重复的未命名接口标题。 */
export function nextUntitledHttpName(items: { name: string }[], base: string): string {
  if (!items.some((i) => i.name === base)) return base
  let n = 2
  while (items.some((i) => i.name === `${base} ${n}`)) n++
  return `${base} ${n}`
}

/** parseKVJson 解析存储的键值 JSON。 */
export function parseKVJson(json: string): HttpKVRow[] {
  try {
    const arr = JSON.parse(json || '[]') as Array<{ key?: string; value?: string; enabled?: boolean }>
    if (!Array.isArray(arr)) return []
    return arr.map((r) => ({
      key: r.key ?? '',
      value: r.value ?? '',
      enabled: r.enabled !== false,
    }))
  } catch {
    return []
  }
}

/** serializeKVRows 序列化键值行（仅含有效 key）。 */
export function serializeKVRows(rows: HttpKVRow[]): string {
  const out = rows
    .filter((r) => r.key.trim())
    .map((r) => ({ key: r.key.trim(), value: r.value, enabled: r.enabled }))
  return JSON.stringify(out)
}

/** kvRowsToHeaders 将启用的键值行转为请求头。 */
export function kvRowsToHeaders(rows: HttpKVRow[]): HTTPHeaderKV[] {
  return rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => ({ key: r.key.trim(), value: r.value }))
}

/** headersToKVRows 请求头转为键值行。 */
export function headersToKVRows(headers: HTTPHeaderKV[]): HttpKVRow[] {
  if (!headers.length) return [emptyKVRow()]
  return headers.map((h) => ({ key: h.key, value: h.value, enabled: true }))
}

/** parseHeaderText 解析「Key: value」多行请求头。 */
export function parseHeaderText(text: string): HTTPHeaderKV[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':')
      if (i < 0) return { key: line, value: '' }
      return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }
    })
    .filter((h) => h.key)
}

/** splitUrlBaseAndQuery 拆分 URL 与查询串。 */
export function splitUrlBaseAndQuery(url: string): { base: string; query: string } {
  const u = url.trim()
  const hash = u.indexOf('#')
  const noHash = hash >= 0 ? u.slice(0, hash) : u
  const q = noHash.indexOf('?')
  if (q < 0) return { base: noHash, query: '' }
  return { base: noHash.slice(0, q), query: noHash.slice(q + 1) }
}

/** parseQueryString 解析查询串为键值行。 */
export function parseQueryString(query: string): HttpKVRow[] {
  if (!query.trim()) return [emptyKVRow()]
  const rows: HttpKVRow[] = []
  for (const part of query.split('&')) {
    const t = part.trim()
    if (!t) continue
    const i = t.indexOf('=')
    if (i < 0) rows.push({ key: decodeURIComponent(t), value: '', enabled: true })
    else {
      rows.push({
        key: decodeURIComponent(t.slice(0, i)),
        value: decodeURIComponent(t.slice(i + 1)),
        enabled: true,
      })
    }
  }
  return rows.length ? rows : [emptyKVRow()]
}

/** buildUrlWithParams 合并 base URL 与查询参数。 */
export function buildUrlWithParams(base: string, rows: HttpKVRow[]): string {
  const b = base.trim()
  const parts = rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => `${encodeURIComponent(r.key.trim())}=${encodeURIComponent(r.value)}`)
  if (!parts.length) return b
  const sep = b.includes('?') ? '&' : '?'
  return `${b}${sep}${parts.join('&')}`
}

/** parseEnvText 解析 key=value 环境变量文本。 */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    if (key) out[key] = t.slice(i + 1).trim()
  }
  return out
}

/** formatEnvText 将环境变量 JSON 格式化为 key=value 多行。 */
export function formatEnvText(json: string): string {
  try {
    const m = JSON.parse(json || '{}') as Record<string, string>
    if (!m || typeof m !== 'object') return ''
    return Object.entries(m)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  } catch {
    return ''
  }
}

/** prettyPrintBody 尝试格式化 JSON 响应/请求体。 */
export function prettyPrintBody(text: string): string {
  const t = text.trim()
  if (!t) return text
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return text
  }
}

/** detectBodyMode 根据 Content-Type 与内容推断请求体模式。 */
export function detectBodyMode(body: string, headers: HTTPHeaderKV[]): HttpBodyMode {
  if (!body.trim()) return 'none'
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  if (ct.includes('json') || (body.trim().startsWith('{') && body.trim().endsWith('}'))) return 'json'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('urlencoded')) return 'form'
  return 'raw'
}

/** buildFormBody 将键值行编码为 application/x-www-form-urlencoded。 */
export function buildFormBody(rows: HttpKVRow[]): string {
  return rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => `${encodeURIComponent(r.key.trim())}=${encodeURIComponent(r.value)}`)
    .join('&')
}

/** applyBodyModeHeaders 按体模式设置 Content-Type。 */
export function applyBodyModeHeaders(headers: HttpKVRow[], mode: HttpBodyMode): HttpKVRow[] {
  const rows = headers.filter((h) => h.key.trim().toLowerCase() !== 'content-type')
  if (mode === 'json') {
    return [...rows, { key: 'Content-Type', value: 'application/json', enabled: true }]
  }
  if (mode === 'xml') {
    return [...rows, { key: 'Content-Type', value: 'application/xml', enabled: true }]
  }
  if (mode === 'form') {
    return [...rows, { key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true }]
  }
  if (mode === 'raw') {
    return [...rows, { key: 'Content-Type', value: 'text/plain', enabled: true }]
  }
  return rows
}

/** mergeCookieHeader 将 Cookie 键值行合并为 Cookie 请求头。 */
export function mergeCookieHeader(headers: HttpKVRow[], cookies: HttpKVRow[]): HttpKVRow[] {
  const rows = headers.filter((h) => h.key.trim().toLowerCase() !== 'cookie')
  const parts = cookies
    .filter((c) => c.enabled && c.key.trim())
    .map((c) => `${c.key.trim()}=${c.value}`)
  if (!parts.length) return rows
  return [...rows, { key: 'Cookie', value: parts.join('; '), enabled: true }]
}

/** extractCookieRows 从请求头解析 Cookie 行。 */
export function extractCookieRows(headers: HttpKVRow[]): { headers: HttpKVRow[]; cookies: HttpKVRow[] } {
  const cookie = headers.find((h) => h.enabled && h.key.trim().toLowerCase() === 'cookie')
  const rest = headers.filter((h) => h.key.trim().toLowerCase() !== 'cookie')
  if (!cookie?.value.trim()) {
    return { headers: rest.length ? rest : [emptyKVRow()], cookies: [emptyKVRow()] }
  }
  const cookies = cookie.value.split(';').map((p) => {
    const t = p.trim()
    const i = t.indexOf('=')
    if (i < 0) return { key: t, value: '', enabled: true }
    return { key: t.slice(0, i).trim(), value: t.slice(i + 1).trim(), enabled: true }
  })
  return { headers: rest.length ? rest : [emptyKVRow()], cookies: cookies.length ? cookies : [emptyKVRow()] }
}

/** formatBodySize 格式化响应体字节大小。 */
export function formatBodySize(text: string): string {
  const n = new TextEncoder().encode(text).length
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** applyAuthHeader 合并 Bearer 认证头。 */
export function applyAuthHeader(headers: HttpKVRow[], mode: HttpAuthMode, token: string): HttpKVRow[] {
  const rows = headers.filter((h) => h.key.trim().toLowerCase() !== 'authorization')
  if (mode === 'bearer' && token.trim()) {
    return [...rows, { key: 'Authorization', value: `Bearer ${token.trim()}`, enabled: true }]
  }
  return rows
}

/** extractBearerToken 从请求头读取 Bearer token。 */
export function extractBearerToken(headers: HttpKVRow[]): { mode: HttpAuthMode; token: string } {
  const row = headers.find((h) => h.enabled && h.key.trim().toLowerCase() === 'authorization')
  if (!row) return { mode: 'none', token: '' }
  const m = /^Bearer\s+(.+)$/i.exec(row.value.trim())
  if (m) return { mode: 'bearer', token: m[1] }
  return { mode: 'none', token: '' }
}

/** methodAllowsBody 判断方法是否可带请求体。 */
export function methodAllowsBody(method: string): boolean {
  return METHODS_WITH_BODY.has(method.toUpperCase())
}

/** statusTone 根据状态码返回展示样式类名。 */
export function statusTone(code: number): 'ok' | 'warn' | 'err' {
  if (code >= 200 && code < 300) return 'ok'
  if (code >= 400) return 'err'
  return 'warn'
}

/** parseCurlCommand 从 cURL 命令解析请求草稿。 */
export function parseCurlCommand(raw: string): {
  method: string
  url: string
  headers: HttpKVRow[]
  body: string
} | null {
  const line = raw.replace(/\\\s*\n/g, ' ').trim()
  if (!/curl\s/i.test(line)) return null
  let method = 'GET'
  let url = ''
  const headers: HttpKVRow[] = []
  let body = ''

  const urlMatch = line.match(/curl\s+(?:-X\s+\w+\s+)?['"]?(https?:\/\/[^\s'"]+)['"]?/i)
  if (urlMatch) url = urlMatch[1]

  const xMatch = line.match(/-X\s+(\w+)/i)
  if (xMatch) method = xMatch[1].toUpperCase()

  const hRe = /-H\s+['"]([^'"]+)['"]/gi
  let hm: RegExpExecArray | null
  while ((hm = hRe.exec(line))) {
    const i = hm[1].indexOf(':')
    if (i < 0) headers.push({ key: hm[1], value: '', enabled: true })
    else headers.push({ key: hm[1].slice(0, i).trim(), value: hm[1].slice(i + 1).trim(), enabled: true })
  }

  const dMatch = line.match(/(?:-d|--data(?:-raw)?)\s+['"]([\s\S]*?)['"]\s*(?:-|$)/i)
  if (dMatch) {
    body = dMatch[1]
    if (method === 'GET') method = 'POST'
  }

  if (!url) return null
  return { method, url, headers: headers.length ? headers : [emptyKVRow()], body }
}

/** toCurlCommand 生成 cURL 命令。 */
export function toCurlCommand(opts: {
  method: string
  url: string
  headers: HTTPHeaderKV[]
  body: string
}): string {
  const parts = ['curl', '-X', opts.method.toUpperCase(), `'${opts.url.replace(/'/g, "'\\''")}'`]
  for (const h of opts.headers) {
    if (!h.key.trim()) continue
    parts.push('-H', `'${h.key}: ${h.value.replace(/'/g, "'\\''")}'`)
  }
  if (opts.body && methodAllowsBody(opts.method)) {
    parts.push('-d', `'${opts.body.replace(/'/g, "'\\''")}'`)
  }
  return parts.join(' ')
}

import type { HTTPResponse } from '../../api/types'

const KEY = 'wn_http_history'
const MAX = 30

export interface HttpHistoryEntry {
  id: string
  at: number
  method: string
  url: string
  name: string
  statusCode: number
  elapsedMs: number
  error: string
}

/** loadHttpHistory 读取本地请求历史。 */
export function loadHttpHistory(): HttpHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as HttpHistoryEntry[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** pushHttpHistory 追加一条历史记录。 */
export function pushHttpHistory(entry: Omit<HttpHistoryEntry, 'id' | 'at'>): HttpHistoryEntry[] {
  const item: HttpHistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  }
  const next = [item, ...loadHttpHistory()].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

/** historyFromResponse 根据响应构造历史条目字段。 */
export function historyFromResponse(
  method: string,
  url: string,
  name: string,
  res: HTTPResponse,
): Omit<HttpHistoryEntry, 'id' | 'at'> {
  return {
    method,
    url,
    name: name || url,
    statusCode: res.statusCode,
    elapsedMs: res.elapsedMs,
    error: res.error ?? '',
  }
}

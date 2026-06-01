const KEY = 'wn_http_stash'

export interface HttpStashPayload {
  name: string
  notes: string
  method: string
  urlBase: string
  paramsJson: string
  headersJson: string
  cookiesJson: string
  body: string
  bodyMode: string
  authMode: string
  authToken: string
  at: number
}

/** loadHttpStashMap 读取全部暂存。 */
function loadMap(): Record<string, HttpStashPayload> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, HttpStashPayload>
  } catch {
    return {}
  }
}

/** saveHttpStash 暂存当前编辑（Apifox「暂存」）。 */
export function saveHttpStash(slot: string, payload: Omit<HttpStashPayload, 'at'>): void {
  const map = loadMap()
  map[slot] = { ...payload, at: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** loadHttpStash 读取暂存。 */
export function loadHttpStash(slot: string): HttpStashPayload | null {
  return loadMap()[slot] ?? null
}

/** clearHttpStash 清除暂存。 */
export function clearHttpStash(slot: string): void {
  const map = loadMap()
  delete map[slot]
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

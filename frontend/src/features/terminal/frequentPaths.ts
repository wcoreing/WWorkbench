import { api } from '../../api/client'

// 与 store.SettingTerminalFrequentPaths 对齐
/** 终端常用路径条目（按主机隔离，按使用次数排序）。 */
export type FrequentPathEntry = {
  path: string
  count: number
  lastAt: number
}

// 与 store.SettingTerminalFrequentPaths 对齐
const SETTING_KEY = 'terminal.frequent_paths'
const MAX_STORE_PER_HOST = 40
const MAX_MENU = 8

type FrequentPathsStore = Record<string, FrequentPathEntry[]>

/** shellSingleQuote 生成 bash 单引号字面量。 */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** frequentPathsHostKey 归一化主机键（本机 / SSH / Docker）。 */
export function frequentPathsHostKey(hostKeyOrId: string): string {
  const k = hostKeyOrId.trim()
  return k || 'local'
}

function parseStore(raw: string): FrequentPathsStore {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: FrequentPathsStore = {}
    for (const [host, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      out[host] = list
        .filter((x): x is FrequentPathEntry => {
          if (!x || typeof x !== 'object') return false
          const e = x as FrequentPathEntry
          return typeof e.path === 'string' && e.path.startsWith('/')
        })
        .map((e) => ({
          path: e.path,
          count: Math.max(1, Number(e.count) || 1),
          lastAt: Number(e.lastAt) || 0,
        }))
    }
    return out
  } catch {
    return {}
  }
}

function sortEntries(list: FrequentPathEntry[]): FrequentPathEntry[] {
  return [...list].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
}

function trimHostList(list: FrequentPathEntry[]): FrequentPathEntry[] {
  return sortEntries(list).slice(0, MAX_STORE_PER_HOST)
}

/** loadFrequentPaths 读取某主机常用路径（已按次数排序）。 */
export async function loadFrequentPaths(hostKey: string): Promise<FrequentPathEntry[]> {
  const settings = await api.listAppSettings()
  const store = parseStore(settings[SETTING_KEY] || '')
  return sortEntries(store[frequentPathsHostKey(hostKey)] || [])
}

/** topFrequentPaths 取菜单展示前 N 条。 */
export function topFrequentPaths(list: FrequentPathEntry[], limit = MAX_MENU): FrequentPathEntry[] {
  return sortEntries(list).slice(0, Math.max(1, limit))
}

/** touchFrequentPath 累计一次使用并落盘，返回该主机最新列表。 */
export async function touchFrequentPath(hostKey: string, path: string): Promise<FrequentPathEntry[]> {
  const key = frequentPathsHostKey(hostKey)
  const p = path.trim()
  if (!p.startsWith('/')) {
    return loadFrequentPaths(key)
  }
  const settings = await api.listAppSettings()
  const store = parseStore(settings[SETTING_KEY] || '')
  const list = store[key] ? [...store[key]] : []
  const now = Math.floor(Date.now() / 1000)
  const idx = list.findIndex((e) => e.path === p)
  if (idx >= 0) {
    list[idx] = { path: p, count: list[idx].count + 1, lastAt: now }
  } else {
    list.push({ path: p, count: 1, lastAt: now })
  }
  store[key] = trimHostList(list)
  await api.setAppSetting(SETTING_KEY, JSON.stringify(store))
  return store[key]
}

/** formatFrequentPathLabel 菜单展示：末两段优先，过长中间省略。 */
export function formatFrequentPathLabel(path: string, max = 36): string {
  const p = path.trim()
  if (p.length <= max) return p
  const parts = p.split('/').filter(Boolean)
  if (parts.length >= 2) {
    const tail = `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    if (tail.length <= max) return tail
  }
  return `${p.slice(0, 10)}…${p.slice(-max + 11)}`
}

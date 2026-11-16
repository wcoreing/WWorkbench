import type { MCPAssetRef, MCPCallLog } from '../../api/types'

export interface MCPIntentGroup {
  key: string
  intent: string
  count: number
  tools: string[]
  resources: MCPAssetRef[]
  logs: MCPCallLog[]
  firstAt: number
  lastAt: number
  okCount: number
  failCount: number
}

export interface MCPResourceGroup {
  key: string
  kind: string
  id: string
  label: string
  count: number
  lastAt: number
  intents: number
}

export const MCP_NO_RESOURCE_KEY = '__none__'
/** 左侧「全部审计」哨兵。 */
export const MCP_ALL_RESOURCE_KEY = '__all__'

export const MCP_ASSET_KINDS = [
  'ssh',
  'database',
  'docker',
  'log',
  'http',
  'note',
  'backup',
  'skill',
  'browser',
  'desktop',
] as const

export function resourceKey(kind: string, id: string): string {
  return `${kind}:${id}`
}

export function resourceLabel(r: Pick<MCPAssetRef, 'kind' | 'id' | 'label'>): string {
  const name = (r.label || r.id || '').trim()
  return name ? `${r.kind}:${name}` : r.kind
}

/** 从流水抽出左侧资源列表（按最近活跃排序）。 */
export function collectMCPResources(logs: MCPCallLog[]): MCPResourceGroup[] {
  const map = new Map<string, MCPResourceGroup & { intentSeen: Set<string> }>()

  for (const log of logs) {
    const refs = log.resources ?? []
    if (refs.length === 0) {
      const key = MCP_NO_RESOURCE_KEY
      let g = map.get(key)
      if (!g) {
        g = {
          key,
          kind: '',
          id: '',
          label: '',
          count: 0,
          lastAt: 0,
          intents: 0,
          intentSeen: new Set(),
        }
        map.set(key, g)
      }
      g.count += 1
      if (log.at > g.lastAt) g.lastAt = log.at
      const intent = (log.intent || '').trim() || '__empty__'
      g.intentSeen.add(intent)
      continue
    }
    for (const r of refs) {
      const key = resourceKey(r.kind, r.id)
      let g = map.get(key)
      if (!g) {
        g = {
          key,
          kind: r.kind,
          id: r.id,
          label: resourceLabel(r),
          count: 0,
          lastAt: 0,
          intents: 0,
          intentSeen: new Set(),
        }
        map.set(key, g)
      } else if (r.label && !g.label.includes(r.label)) {
        g.label = resourceLabel(r)
      }
      g.count += 1
      if (log.at > g.lastAt) g.lastAt = log.at
      const intent = (log.intent || '').trim() || '__empty__'
      g.intentSeen.add(intent)
    }
  }

  const out: MCPResourceGroup[] = []
  for (const g of map.values()) {
    out.push({
      key: g.key,
      kind: g.kind,
      id: g.id,
      label: g.label,
      count: g.count,
      lastAt: g.lastAt,
      intents: g.intentSeen.size,
    })
  }
  out.sort((a, b) => b.lastAt - a.lastAt)
  return out
}

/** 过滤触及某资源的流水（无资源桶 = 无 resources）。 */
export function filterLogsByResource(logs: MCPCallLog[], resourceKeySel: string): MCPCallLog[] {
  if (!resourceKeySel) return logs
  if (resourceKeySel === MCP_NO_RESOURCE_KEY) {
    return logs.filter((l) => !l.resources || l.resources.length === 0)
  }
  return logs.filter((l) =>
    (l.resources ?? []).some((r) => resourceKey(r.kind, r.id) === resourceKeySel),
  )
}

/** 按意图聚合（同 intent 合并；空意图各自独立）。 */
export function groupMCPLogsByIntent(logs: MCPCallLog[]): MCPIntentGroup[] {
  const byIntent = new Map<string, MCPIntentGroup>()
  const emptyGroups: MCPIntentGroup[] = []

  for (const log of logs) {
    const intent = (log.intent || '').trim()
    if (intent === '') {
      emptyGroups.push({
        key: `empty:${log.id}`,
        intent: '',
        count: 1,
        tools: [log.tool],
        resources: [...(log.resources ?? [])],
        logs: [log],
        firstAt: log.at,
        lastAt: log.at,
        okCount: log.ok ? 1 : 0,
        failCount: log.ok ? 0 : 1,
      })
      continue
    }

    let cur = byIntent.get(intent)
    if (!cur) {
      cur = {
        key: `intent:${intent}`,
        intent,
        count: 0,
        tools: [],
        resources: [],
        logs: [],
        firstAt: log.at,
        lastAt: log.at,
        okCount: 0,
        failCount: 0,
      }
      byIntent.set(intent, cur)
    }
    cur.count += 1
    cur.logs.push(log)
    if (log.at > cur.lastAt) cur.lastAt = log.at
    if (log.at < cur.firstAt) cur.firstAt = log.at
    if (log.ok) cur.okCount += 1
    else cur.failCount += 1
    if (!cur.tools.includes(log.tool)) cur.tools.push(log.tool)
    for (const r of log.resources ?? []) {
      if (!cur.resources.some((x) => x.kind === r.kind && x.id === r.id)) {
        cur.resources.push(r)
      }
    }
  }

  const named = [...byIntent.values()]
  for (const g of named) {
    g.logs.sort((a, b) => a.at - b.at)
  }
  named.sort((a, b) => b.lastAt - a.lastAt)
  emptyGroups.sort((a, b) => b.lastAt - a.lastAt)
  return [...named, ...emptyGroups]
}

export function formatMCPTime(at: number): string {
  if (!at) return '—'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 从 argsSummary 抽出列表行可见的具体命令/SQL/URL 等。 */
export function mcpCallDetail(tool: string, argsSummary?: string): string {
  if (!argsSummary) return ''
  let m: Record<string, unknown>
  try {
    m = JSON.parse(argsSummary) as Record<string, unknown>
  } catch {
    return ''
  }
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = m[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  const cmd = str('command')
  if (cmd) return cmd
  const sql = str('sql', 'initialSql', 'query')
  if (sql) return sql.replace(/\s+/g, ' ')
  const url = str('url')
  if (url) {
    const method = str('method')
    return method ? `${method.toUpperCase()} ${url}` : url
  }
  const skill = str('skill', 'name', 'workflow')
  if (skill && /skill|workflow/i.test(tool)) return skill
  const path = str('path', 'workDir')
  if (path) return path
  const action = str('action')
  if (action) return action
  const role = str('role')
  if (role && tool.includes('note')) return `role=${role}`
  return ''
}

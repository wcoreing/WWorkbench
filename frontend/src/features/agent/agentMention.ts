/** AgentMentionKind @ 资源类型。 */
export type AgentMentionKind = 'ssh' | 'database' | 'docker' | 'log' | 'http'

/** AgentMention 用户 @ 选中的资源。 */
export interface AgentMention {
  kind: AgentMentionKind
  id: string
  label: string
  sublabel?: string
}

/** AgentMentionMenuItem 弹出菜单候选项。 */
export interface AgentMentionMenuItem extends AgentMention {}

/** findActiveMentionQuery 检测光标处 @ 查询串；无则返回 null。 */
export function findActiveMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const segment = before.slice(at + 1)
  if (/[\s\n]/.test(segment)) return null
  return { start: at, query: segment }
}

/** insertMentionToken 在 @ 位置插入展示名并返回新文本与光标。 */
export function insertMentionToken(
  text: string,
  atStart: number,
  cursor: number,
  label: string,
): { text: string; cursor: number } {
  const token = `@${label} `
  const next = text.slice(0, atStart) + token + text.slice(cursor)
  const pos = atStart + token.length
  return { text: next, cursor: pos }
}

/** toContextMentions 转为后端 AgentMentionDO 结构（sublabel 带进 label，供前馈展示真实地址）。 */
export function toContextMentions(mentions: AgentMention[]) {
  return mentions.map((m) => ({
    kind: m.kind,
    id: m.id,
    label: m.sublabel ? `${m.label} · ${m.sublabel}` : m.label,
  }))
}

/** mergeMentions 合并 @ 列表并去重。 */
export function mergeMentions(...groups: AgentMention[][]): AgentMention[] {
  const seen = new Set<string>()
  const out: AgentMention[] = []
  for (const list of groups) {
    for (const m of list) {
      const key = `${m.kind}:${m.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
  }
  return out
}

/** mentionKindShort @ chip 上的类型缩写。 */
export function mentionKindShort(kind: AgentMentionKind): string {
  switch (kind) {
    case 'ssh':
      return 'SSH'
    case 'docker':
      return 'DK'
    case 'log':
      return 'LOG'
    case 'http':
      return 'API'
    default:
      return 'DB'
  }
}

export interface AgentAutoMentionInput {
  activeProduct: string
  surface: {
    focusKind?: string
    focusLabel?: string
    hostId?: string
    connectionId?: string
  }
  activeConnectionId: string | null
  sessionConnectionId?: string
  connections: { id: string; name: string; host: string; dbType: string }[]
}

/** filterEphemeralAutoMentions 本轮自动附加（已在 mentions 中的剔除）。 */
export function filterEphemeralAutoMentions(
  autoMentions: AgentMention[],
  mentions: AgentMention[],
): AgentMention[] {
  return autoMentions.filter(
    (a) => !mentions.some((m) => m.kind === a.kind && m.id === a.id),
  )
}

/** buildAutoMentions 根据界面快照与当前产品线生成默认 @ 资源。 */
export function buildAutoMentions(input: AgentAutoMentionInput): AgentMention[] {
  const out: AgentMention[] = []
  const s = input.surface
  if (
    (input.activeProduct === 'terminal' && s.focusKind === 'terminal.ssh' && s.hostId) ||
    (input.activeProduct === 'sftp' && s.focusKind === 'sftp' && s.hostId) ||
    (input.activeProduct === 'docker' && s.hostId) ||
    (input.activeProduct === 'environment' && s.hostId)
  ) {
    out.push({
      kind: 'ssh',
      id: s.hostId!,
      label: s.focusLabel || s.hostId!,
    })
  }
  const connId = input.sessionConnectionId || input.activeConnectionId || s.connectionId || ''
  if (input.activeProduct === 'database' && connId) {
    const c = input.connections.find((x) => x.id === connId)
    out.push({
      kind: 'database',
      id: connId,
      label: c?.name?.trim() || c?.host || connId,
      sublabel: c ? `${c.dbType} · ${c.host}` : undefined,
    })
  }
  return out
}

/** parseMentionsFromEvent 解析后端推送的 mentions。 */
export function parseMentionsFromEvent(raw: unknown): AgentMention[] {
  if (!Array.isArray(raw)) return []
  const out: AgentMention[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind =
      o.kind === 'ssh' ||
      o.kind === 'database' ||
      o.kind === 'docker' ||
      o.kind === 'log' ||
      o.kind === 'http'
        ? o.kind
        : null
    const id = String(o.id ?? '')
    const label = String(o.label ?? '')
    if (!kind || !id) continue
    out.push({ kind, id, label })
  }
  return out
}

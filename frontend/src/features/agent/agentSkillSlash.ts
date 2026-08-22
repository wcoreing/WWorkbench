/** Agent Skill 斜杠命令解析与菜单查询。 */

export interface SkillRef {
  id: string
  name: string
  description?: string
}

/** findActiveSkillQuery 光标前若在 /token 中则返回查询。 */
export function findActiveSkillQuery(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor)
  const m = before.match(/(^|\s)\/([^\s/]*)$/)
  if (!m) return null
  const token = m[2] ?? ''
  const start = before.length - token.length - 1
  return { start, query: token }
}

/** filterSkills 按 id/name/description 过滤。 */
export function filterSkills(skills: SkillRef[], query: string): SkillRef[] {
  const q = query.trim().toLowerCase()
  if (!q) return skills
  return skills.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q),
  )
}

/**
 * resolveSkillToken 解析 /token：先精确匹配 id/name，再模糊匹配（唯一命中时生效）。
 */
export function resolveSkillToken(token: string, skills: SkillRef[]): SkillRef | undefined {
  const t = token.trim()
  if (!t) return undefined
  const exact = skills.find(
    (s) =>
      s.id === t ||
      s.id.toLowerCase() === t.toLowerCase() ||
      s.name === t ||
      s.name.toLowerCase() === t.toLowerCase(),
  )
  if (exact) return exact
  const q = t.toLowerCase()
  const partial = skills.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q),
  )
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    const starts = partial.filter((s) => s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().startsWith(q))
    if (starts.length === 1) return starts[0]
    partial.sort((a, b) => a.id.length - b.id.length)
    return partial[0]
  }
  return undefined
}

/**
 * parseLeadingSkillCommand 解析消息开头的 /id 或 /name；
 * 返回剥离后的正文与 skillIds。
 */
export function parseLeadingSkillCommand(text: string, skills: SkillRef[]): { message: string; skillIds: string[] } {
  const trimmed = text.trim()
  const m = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!m) return { message: text, skillIds: [] }
  const token = m[1]
  const rest = (m[2] || '').trim()
  const hit = resolveSkillToken(token, skills)
  if (!hit) return { message: text, skillIds: [] }
  return { message: rest, skillIds: [hit.id] }
}

/** defaultSkillPrompt 无附加正文时的默认调用语。 */
export function defaultSkillPrompt(skill: SkillRef): string {
  return `请按技能「${skill.name}」执行。`
}

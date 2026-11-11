/** 笔记 ↔ Skill 关联标记（写在笔记正文顶部）。 */

const SKILL_MARK_RE = /<!--\s*wwb-skill:\s*([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\s*-->/

/** readLinkedSkillId 从笔记正文读取已关联 skill id。 */
export function readLinkedSkillId(content: string): string {
  const m = content.match(SKILL_MARK_RE)
  return m?.[1] ?? ''
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** withLinkedSkillId 写入/更新关联标记（放在 frontmatter 之后）。 */
export function withLinkedSkillId(content: string, skillId: string): string {
  const id = skillId.trim()
  const mark = `<!-- wwb-skill: ${id} -->`
  if (SKILL_MARK_RE.test(content)) {
    return content.replace(SKILL_MARK_RE, mark)
  }
  const m = content.match(FM_RE)
  if (m) {
    const body = content.slice(m[0].length).replace(/^\s+/, '')
    return `${m[0]}\n${mark}\n\n${body}`
  }
  const trimmed = content.replace(/^\s+/, '')
  return `${mark}\n\n${trimmed}`
}

/** suggestSkillId 从标题或笔记 id 推导合法 skill id。 */
export function suggestSkillId(title: string, noteId: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (ascii && /^[a-z0-9]/.test(ascii)) return ascii
  const short = noteId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'note'
  return `note-${short}`
}

/** stripSkillMark 发布时去掉标记，避免写进 Skill 正文。 */
export function stripSkillMark(content: string): string {
  return content.replace(SKILL_MARK_RE, '').replace(/^\s+/, '')
}

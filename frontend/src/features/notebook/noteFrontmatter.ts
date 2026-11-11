/** 笔记 YAML frontmatter：role 与正文同步（与后端 SyncNoteMeta 对齐）。 */

import { ensureWorkflowStepsFence, languageForRole } from './noteFileTypes'

export type NoteRoleValue = 'note' | 'memory' | 'skill'

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function normalizeRole(role: string): NoteRoleValue {
  if (role === 'memory') return 'memory'
  if (role === 'skill') return 'skill'
  return 'note'
}

/** withNoteRole 写入/更新 frontmatter role；普通笔记可去掉 role 行。 */
export function withNoteRole(content: string, role: NoteRoleValue): string {
  const nextRole = normalizeRole(role || 'note')
  const m = content.match(FM_RE)
  if (!m) {
    if (nextRole === 'note') return content
    const body = content.replace(/^\s+/, '')
    return `---\nrole: ${nextRole}\n---\n\n${body}`
  }
  const raw = m[1]
  const body = content.slice(m[0].length)
  const lines = raw.split(/\r?\n/).filter((ln) => !/^\s*role\s*:/i.test(ln))
  if (nextRole !== 'note') {
    lines.unshift(`role: ${nextRole}`)
  }
  const block = lines.filter((ln) => ln.trim() !== '').join('\n')
  if (!block) {
    return body.replace(/^\s+/, '')
  }
  return `---\n${block}\n---\n\n${body.replace(/^\s+/, '')}`
}

/** applyNoteRoleFields 改角色时同步 frontmatter、文件类型与工作流步骤骨架。 */
export function applyNoteRoleFields(
  note: { content: string; language: string },
  role: NoteRoleValue,
): { role: NoteRoleValue; content: string; language: string } {
  const nextRole = normalizeRole(role)
  let content = withNoteRole(note.content, nextRole)
  if (nextRole === 'skill') content = ensureWorkflowStepsFence(content)
  return {
    role: nextRole,
    content,
    language: languageForRole(nextRole, note.language),
  }
}

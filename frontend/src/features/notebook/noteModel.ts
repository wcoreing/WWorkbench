import { model } from '../../../wailsjs/go/models'
import type { Note, NoteSummary } from '../../api/types'

/** noteContentSnapshot 可持久化字段快照（判断 dirty / 防无意义保存）。 */
export function noteContentSnapshot(note: Note): string {
  return JSON.stringify({
    title: note.title,
    content: note.content,
    groupId: note.groupId,
    language: note.language,
    role: note.role || 'note',
    sshHostId: note.sshHostId,
    connectionId: note.connectionId,
  })
}

/** toNoteDO 前端 Note → Wails NoteDO。 */
export function toNoteDO(note: Note): model.NoteDO {
  return model.NoteDO.createFrom({
    id: note.id,
    groupId: note.groupId,
    title: note.title,
    content: note.content,
    language: note.language,
    role: note.role || 'note',
    sshHostId: note.sshHostId,
    connectionId: note.connectionId,
    sortOrder: note.sortOrder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  })
}

/** formatNoteUpdatedAt 侧栏用短时间（updatedAt 为秒）；0 返回空。 */
export function formatNoteUpdatedAt(updatedAt: number, nowMs = Date.now()): string {
  const sec = Number(updatedAt) || 0
  if (sec <= 0) return ''
  const d = new Date(sec * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date(nowMs)
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** formatNoteUpdatedAtFull 悬停完整时间。 */
export function formatNoteUpdatedAtFull(updatedAt: number): string {
  const sec = Number(updatedAt) || 0
  if (sec <= 0) return ''
  const d = new Date(sec * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** toSummary Note → 侧栏摘要。 */
export function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    groupId: note.groupId,
    title: note.title,
    language: note.language,
    role: note.role || 'note',
    sshHostId: note.sshHostId,
    connectionId: note.connectionId,
    sortOrder: note.sortOrder,
    updatedAt: note.updatedAt,
  }
}

/** adoptNoteLanguage 历史 plaintext 升 markdown；补默认 role。 */
export function adoptNoteLanguage(note: Note): Note {
  const role = note.role || 'note'
  if (note.language === 'plaintext') {
    return { ...note, language: 'markdown', role }
  }
  if (note.role) return note
  return { ...note, role }
}

/** skillEntryNoteId 目录 → SKILL.md 入口笔记 id（就地；对齐后端 SkillEntryIDInDir）。 */
export function skillEntryNoteId(scopeRootId: string): string {
  const root = (scopeRootId || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return ''
  if (/\/SKILL\.md$/i.test(root)) return root
  return `${root}/SKILL.md`
}

/**
 * skillNameFromNoteId 从 …/SKILL.md 还原对外引用名。
 * 工作流/{short}/SKILL.md → short；其它位置 → 完整目录路径（对齐后端 SkillNameFromNoteID）。
 */
export function skillNameFromNoteId(noteId: string): string {
  const id = (noteId || '').replace(/\\/g, '/').trim()
  const m = id.match(/^(.*)\/SKILL\.md$/i)
  if (!m?.[1]) return ''
  const dir = m[1]
  const short = dir.match(/^工作流\/([^/]+)$/)
  if (short?.[1]) return short[1]
  return dir
}

/** dirRelFromScope 作用域目录 → 笔记本相对路径（去掉尾 / 与 SKILL.md）。 */
export function dirRelFromScope(scopeRootId: string): string {
  return (scopeRootId || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/SKILL\.md$/i, '')
    .trim()
}

/** dirRelFromNoteId 笔记所在文件夹（根目录单文件返回空，不建仓）。 */
export function dirRelFromNoteId(noteId: string): string {
  const id = (noteId || '').replace(/\\/g, '/').replace(/\/+$/, '').trim()
  const i = id.lastIndexOf('/')
  if (i <= 0) return ''
  return id.slice(0, i)
}

/** 笔记本工作区相对路径工具（对齐磁盘真源）。 */

export type NotebookClipboard = { mode: 'cut' | 'copy'; rels: string[] }

export type NotebookInlineEdit =
  | { kind: 'rename'; rel: string; value: string }
  | { kind: 'create'; parent: string; isDir: boolean; value: string }

/** remapRel 路径变更后重写 id（自身或子孙）。 */
export function remapRel(id: string, from: string, to: string): string {
  if (!id || !from) return id
  if (id === from) return to
  if (id.startsWith(from + '/')) return to + id.slice(from.length)
  return id
}

export function basenameRel(rel: string): string {
  const p = rel.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

export function dirnameRel(rel: string): string {
  const p = rel.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i) : ''
}

export function joinRel(parent: string, name: string): string {
  const p = (parent || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const n = name.replace(/\\/g, '/').replace(/^\/+/, '')
  return p ? `${p}/${n}` : n
}

/** opRelForNote Skill 笔记操作作用在目录上。 */
export function opRelForNote(noteId: string): string {
  const id = noteId.replace(/\\/g, '/')
  if (/\/SKILL\.md$/i.test(id)) return dirnameRel(id)
  return id
}

export function canMoveInto(fromRel: string, destDir: string): boolean {
  const from = fromRel.replace(/\\/g, '/').replace(/\/+$/, '')
  const dest = (destDir || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!from) return false
  if (from === dest) return false
  if (dest.startsWith(from + '/')) return false
  if (dirnameRel(from) === dest) return false
  return true
}

export function uniqueSiblingName(existing: string[], preferred: string): string {
  const set = new Set(existing.map((x) => x.toLowerCase()))
  if (!set.has(preferred.toLowerCase())) return preferred
  const extMatch = preferred.match(/(\.[^.]+)$/)
  const ext = extMatch ? extMatch[1] : ''
  const stem = ext ? preferred.slice(0, -ext.length) : preferred
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? `${stem} 副本${ext}` : `${stem} 副本${i}${ext}`
    if (!set.has(name.toLowerCase())) return name
  }
  return `${stem}-${Date.now()}${ext}`
}

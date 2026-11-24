function decodePathSegment(seg: string): string | null {
  try {
    return decodeURIComponent(seg)
  } catch {
    return null
  }
}

/** parseNotebookAssetHref 从预览链接取出笔记路径和存储文件名。 */
export function parseNotebookAssetHref(href: string): { noteId: string; file: string } | null {
  const raw = (href || '').trim()
  const marker = '/notebook-assets/'
  const at = raw.indexOf(marker)
  if (at < 0) return null
  const rest = raw.slice(at + marker.length).split(/[?#]/)[0]
  const parts = rest.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const decoded = parts.map(decodePathSegment)
  if (decoded.some((seg) => seg == null)) return null
  const segs = decoded as string[]
  const file = segs[segs.length - 1]
  const noteId = segs.slice(0, -1).join('/')
  if (!noteId || !file || file.includes('/') || noteId.includes('..') || file === '.' || file === '..') {
    return null
  }
  return { noteId, file }
}

/** rewriteNotebookAssetLinks 把磁盘相对附件链接映射为 AssetServer URL，供预览渲染。 */
export function rewriteNotebookAssetLinks(content: string, noteId: string): string {
  const id = (noteId || '').trim()
  if (!id || !content) return content
  const prefix = `/notebook-assets/${id.split('/').map(encodeURIComponent).join('/')}/`
  let out = content
  // Skill：assets/file
  out = out.replace(/\]\((?:\.\.?\/)?assets\/([^)\s]+)\)/g, (_m, file: string) => {
    return `](${prefix}${encodeURIComponent(file)})`
  })
  // 普通笔记：{stem}/assets/file
  out = out.replace(/\]\((?:\.\.?\/)?([^)\s/]+)\/assets\/([^)\s]+)\)/g, (_m, _stem: string, file: string) => {
    return `](${prefix}${encodeURIComponent(file)})`
  })
  return out
}

/** skillImageSrc 技能 assets 下的图片笔记 → AssetServer URL。 */
export function skillImageSrc(noteId: string): string {
  const id = (noteId || '').replace(/\\/g, '/')
  const slash = id.lastIndexOf('/')
  const file = slash >= 0 ? id.slice(slash + 1) : id
  const dir = slash >= 0 ? id.slice(0, slash) : ''
  const skillDir = dir.endsWith('/assets') ? dir.slice(0, -'/assets'.length) : dir
  const skillNote = `${skillDir}/SKILL.md`
  const prefix = `/notebook-assets/${skillNote.split('/').map(encodeURIComponent).join('/')}/`
  return prefix + encodeURIComponent(file)
}

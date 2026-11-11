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
  // 普通笔记：{stem}.assets/file
  out = out.replace(/\]\((?:\.\.?\/)?([^)\s/]+)\.assets\/([^)\s]+)\)/g, (_m, _stem: string, file: string) => {
    return `](${prefix}${encodeURIComponent(file)})`
  })
  return out
}

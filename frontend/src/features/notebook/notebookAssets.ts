/** 笔记本附件：粘贴/拖放收集与 base64 读取。 */

const IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

/** isNotebookImageMime 是否按图片插入 Markdown。 */
export function isNotebookImageMime(mime: string): boolean {
  const m = mime.toLowerCase()
  return IMAGE_MIME.has(m) || (m.startsWith('image/') && m !== 'image/svg+xml')
}

/** collectTransferFiles 从粘贴/拖放取出文件（含剪贴板图片与任意附件）。 */
export function collectTransferFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  if (dt.files?.length) {
    for (const f of Array.from(dt.files)) {
      if (f && f.size > 0) out.push(f)
    }
  }
  if (out.length) return out
  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== 'file') continue
    const f = item.getAsFile()
    if (f && f.size > 0) out.push(f)
  }
  return out
}

/** fileToBase64DataURL 读为 data URL（供后端 SaveNotebookAsset）。 */
export function fileToBase64DataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}

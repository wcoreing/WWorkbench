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
    const type = item.type.toLowerCase()
    if (item.kind !== 'file' && !type.startsWith('image/')) continue
    const f = item.getAsFile()
    if (!f) continue
    if (f.size === 0 && !type.startsWith('image/') && !f.type.toLowerCase().startsWith('image/')) continue
    out.push(f)
  }
  return out
}

/** collectLocalFilePaths 从剪贴板取出本机文件路径（访达复制的 file URL）。 */
export function collectLocalFilePaths(dt: DataTransfer | null): string[] {
  if (!dt) return []
  const chunks = [dt.getData('text/uri-list'), dt.getData('text/plain')]
  const out: string[] = []
  for (const chunk of chunks) {
    if (!chunk) continue
    for (const line of chunk.split(/\r?\n/)) {
      const path = fileURLToPath(line.trim())
      if (path) out.push(path)
    }
  }
  return [...new Set(out)]
}

function fileURLToPath(raw: string): string {
  if (!raw || raw.startsWith('#')) return ''
  if (raw.startsWith('file://')) {
    try {
      const url = new URL(raw)
      let path = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
      return path
    } catch {
      return ''
    }
  }
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) return raw
  return ''
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

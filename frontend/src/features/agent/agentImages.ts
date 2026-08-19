/** ChatImage 对话待发送/展示的图片（data 为 data URL）。 */
export interface ChatImage {
  mime: string
  data: string
}

const MAX_IMAGES = 4
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

/** isImageMime 是否为允许粘贴的图片类型。 */
export function isImageMime(mime: string): boolean {
  const m = mime.toLowerCase()
  return m === 'image/png' || m === 'image/jpeg' || m === 'image/jpg' || m === 'image/webp' || m === 'image/gif'
}

/** collectClipboardImages 从粘贴/拖放中取出图片文件。 */
export function collectClipboardImages(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  if (dt.files && dt.files.length) {
    for (const f of Array.from(dt.files)) {
      if (isImageMime(f.type)) out.push(f)
    }
  }
  if (out.length) return out
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file' && isImageMime(item.type)) {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  return out
}

/** fileToChatImage 压缩为可发送的 data URL。 */
export async function fileToChatImage(file: File): Promise<ChatImage> {
  const raw = await readAsDataURL(file)
  if (file.type === 'image/gif') {
    return { mime: 'image/gif', data: raw }
  }
  const compressed = await compressDataURL(raw, file.type)
  return compressed
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read image failed'))
    reader.readAsDataURL(file)
  })
}

function compressDataURL(dataURL: string, mime: string): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve({ mime: mime || 'image/png', data: dataURL })
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const keepPng = mime === 'image/png' && scale === 1
      const outMime = keepPng ? 'image/png' : 'image/jpeg'
      const data = canvas.toDataURL(outMime, JPEG_QUALITY)
      resolve({ mime: outMime, data })
    }
    img.onerror = () => reject(new Error('decode image failed'))
    img.src = dataURL
  })
}

/** mergeChatImages 追加图片，最多 MAX_IMAGES 张。 */
export function mergeChatImages(prev: ChatImage[], next: ChatImage[]): ChatImage[] {
  return [...prev, ...next].slice(0, MAX_IMAGES)
}

export const AGENT_MAX_CHAT_IMAGES = MAX_IMAGES

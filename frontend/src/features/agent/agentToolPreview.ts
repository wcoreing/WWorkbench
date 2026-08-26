function truncate(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function formatPreviewValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.length > 24 ? `${v.slice(0, 24)}…` : v
  if (typeof v === 'object') return '…'
  return String(v)
}

/** 工具条标题行：仅展示入参摘要，空入参返回空串。 */
export function previewToolArgs(args?: string): string {
  const s = (args || '').trim()
  if (!s || s === '{}' || s === 'null') return ''
  try {
    const j = JSON.parse(s) as Record<string, unknown>
    if (typeof j !== 'object' || j === null || Array.isArray(j)) return truncate(s)
    const keys = Object.keys(j)
    if (keys.length === 0) return ''
    if (keys.length === 1) {
      const key = keys[0]
      const value = j[key]
      if (typeof value === 'string') return truncate(value)
      return truncate(`${key}=${formatPreviewValue(value)}`)
    }
    const parts = keys.slice(0, 3).map((key) => {
      const value = j[key]
      if (typeof value === 'string' && value.length > 20) return `${key}=…`
      return `${key}=${formatPreviewValue(value)}`
    })
    const tail = keys.length > 3 ? '…' : ''
    return truncate(`${parts.join(', ')}${tail}`)
  } catch {
    return truncate(s)
  }
}

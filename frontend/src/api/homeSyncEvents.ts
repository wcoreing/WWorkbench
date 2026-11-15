import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface HomeSyncProgressEvent {
  stage: string
  percent: number
  message: string
  bytes?: number
  bytesGzip?: number
  docs?: number
  docsTotal?: number
  durationMs?: number
}

/** onHomeSyncProgress 订阅账号整包同步进度。 */
export function onHomeSyncProgress(handler: (evt: HomeSyncProgressEvent) => void): () => void {
  return EventsOn('home:sync', (raw: Record<string, unknown>) => {
    handler({
      stage: String(raw.stage ?? ''),
      percent: Number(raw.percent ?? 0),
      message: String(raw.message ?? ''),
      bytes: raw.bytes != null ? Number(raw.bytes) : undefined,
      bytesGzip: raw.bytesGzip != null ? Number(raw.bytesGzip) : undefined,
      docs: raw.docs != null ? Number(raw.docs) : undefined,
      docsTotal: raw.docsTotal != null ? Number(raw.docsTotal) : undefined,
      durationMs: raw.durationMs != null ? Number(raw.durationMs) : undefined,
    })
  })
}

/** formatBytes 人类可读字节。 */
export function formatBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return ''
  const u = 1024
  if (n < u) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / u
  let i = 0
  while (v >= u && i < units.length - 1) {
    v /= u
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

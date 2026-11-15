/** 内联 waitFor*：点完/导航后短轮询，省掉单独 browser_wait 一跳。 */
import { sleep } from './state'
import { ensureContent, sendToTab } from './tabs'

export type WaitForSpec = {
  text?: string
  textGone?: string
  nameIncludes?: string
  ref?: string
  selector?: string
  readyState?: boolean
  frame?: string
  timeoutMs: number
  pollMs: number
}

/** 从 click/navigate 参数解析 waitFor*；无条件返回 null。 */
export function extractWaitFor(args: Record<string, unknown> = {}): WaitForSpec | null {
  // waitFor / waitForText：字符串即等正文；true 非法
  let text: string | undefined
  const wf = args.waitFor ?? args.waitForText
  if (typeof wf === 'string' && wf.trim()) text = wf.trim()
  else if (typeof args.waitForText === 'string' && args.waitForText.trim()) text = args.waitForText.trim()

  const textGone = String(args.waitForTextGone || '').trim() || undefined
  const nameIncludes =
    String(args.waitForNameIncludes || args.waitForName || '').trim() || undefined
  const ref = String(args.waitForRef || '').trim() || undefined
  const selector = String(args.waitForSelector || '').trim() || undefined
  const readyState = args.waitForReady === true || args.waitForReadyState === true

  if (!text && !textGone && !nameIncludes && !ref && !selector && !readyState) return null

  const timeoutMs = Math.min(
    Math.max(Number(args.waitForTimeoutMs || args.waitTimeoutMs) || 3000, 200),
    20000,
  )
  const pollMs = Math.min(Math.max(Number(args.waitForPollMs) || 80, 40), 500)
  const frame = String(args.frame || args.waitForFrame || '').trim() || undefined

  return { text, textGone, nameIncludes, ref, selector, readyState, frame, timeoutMs, pollMs }
}

export function waitForProbeArgs(spec: WaitForSpec): Record<string, unknown> {
  const a: Record<string, unknown> = {}
  if (spec.text) a.text = spec.text
  if (spec.textGone) a.textGone = spec.textGone
  if (spec.nameIncludes) a.nameIncludes = spec.nameIncludes
  if (spec.ref) a.ref = spec.ref
  if (spec.selector) a.selector = spec.selector
  if (spec.readyState) a.readyState = true
  if (spec.frame) a.frame = spec.frame
  return a
}

/** 短轮询 probe，命中即返回（默认 3s，比独立 wait 的 8s 更狠）。 */
export async function probeUntil(
  tid: number,
  spec: WaitForSpec,
): Promise<{ matched: boolean; timedOut: boolean; waitedMs: number; probe?: unknown; error?: string }> {
  const probeArgs = waitForProbeArgs(spec)
  const started = Date.now()
  let last: { ok?: boolean; data?: any; error?: string } | null = null
  let injected = false
  while (Date.now() - started < spec.timeoutMs) {
    if (!injected) {
      await ensureContent(tid)
      injected = true
    }
    const res = await sendToTab(tid, 'probe', probeArgs)
    last = res
    if (res?.ok && res.data?.matched) {
      return {
        matched: true,
        timedOut: false,
        waitedMs: Date.now() - started,
        probe: res.data,
      }
    }
    if (res && res.ok === false && /Receiving end|Could not establish|no_receiver/i.test(res.error || '')) {
      injected = false
    }
    await sleep(spec.pollMs)
  }
  return {
    matched: false,
    timedOut: true,
    waitedMs: Date.now() - started,
    probe: last?.data || null,
    error: last?.ok === false ? last.error : undefined,
  }
}

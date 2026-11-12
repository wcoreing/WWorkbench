import { fail, ok, type CmdResult } from '../shared/types'
import { cdpResolveBox, debuggerMouseClick, debuggerMouseDrag } from './debugger'
import { sendWithRefRetry } from './retry'
import { sleep } from './state'
import { ensureContent, focusTab, sendToTab, wantActivateWindow } from './tabs'

export async function handleClick(tid: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const mode = String(args?.mode || 'auto').toLowerCase()
  await focusTab(tid, wantActivateWindow(args))
  await ensureContent(tid)

  if (mode === 'dom') {
    const res = await sendWithRefRetry(tid, 'click', args)
    return res?.ok
      ? ok({ ...(res.data || {}), mode: 'dom', retried: (res as any).retried })
      : fail(res?.error || '点击失败', res?.code || 'click_failed')
  }

  let box = await sendWithRefRetry(tid, 'resolve_box', args)
  let via = 'content'
  const nameHint = String(args?.name || args?.query || args?.text || args?.ref || '')
  const selectorHint = String(args?.selector || '')

  // Closed shadow / 深层：CDP performSearch 或 AX 名称兜底
  // 内容脚本常命中巨大自定义宿主（如 xhs-publish-btn 864px），需再比一轮 CDP 内部 button
  const contentTooCoarse =
    !!box?.ok &&
    (Number(box.data?.width) > 280 ||
      Number(box.data?.height) > 80 ||
      /-/i.test(String(box.data?.tag || '')))
  if (!box?.ok || contentTooCoarse) {
    const cdpBox = await cdpResolveBox(tid, {
      selector: selectorHint,
      name: nameHint,
    }).catch(() => null)
    if (cdpBox) {
      const preferCdp =
        !box?.ok ||
        (cdpBox.width > 0 &&
          cdpBox.width * cdpBox.height < Number(box.data?.width || 1e9) * Number(box.data?.height || 1e9) * 0.6)
      if (preferCdp) {
        box = { ok: true, data: cdpBox }
        via = cdpBox.via
      }
    }
  }

  if (!box?.ok) {
    if (mode === 'pointer') {
      return fail(box?.error || '无法定位元素（含 CDP 兜底）', 'not_found')
    }
    const syn = await sendWithRefRetry(tid, 'click', args)
    if (syn?.ok) return ok({ ...(syn.data || {}), mode: 'dom' })
    return fail(box?.error || syn?.error || '无法定位元素', 'not_found')
  }

  try {
    await debuggerMouseClick(tid, box.data)
    return ok({ ...(box.data || {}), mode: 'pointer', via, retried: (box as any).retried })
  } catch (e) {
    const err = String((e as Error)?.message || e)
    if (mode === 'pointer') {
      return fail('真指针点击失败: ' + err, 'pointer_failed')
    }
    const syn = await sendWithRefRetry(tid, 'click', args)
    if (syn?.ok) {
      return ok({ ...(syn.data || {}), mode: 'dom', pointerError: err })
    }
    return fail(syn?.error || err, 'click_failed')
  }
}

export async function handleDrag(tid: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  await focusTab(tid, wantActivateWindow(args))
  await ensureContent(tid)

  const fromArgs = {
    ref: args.fromRef || args.ref,
    selector: args.fromSelector || args.selector,
    frame: args.frame,
  }
  const toArgs = {
    ref: args.toRef,
    selector: args.toSelector,
    frame: args.toFrame || args.frame,
  }
  if (!fromArgs.ref && !fromArgs.selector && args.fromX == null) {
    return fail('请提供 fromRef/fromSelector 或 fromX/fromY', 'invalid_arg')
  }
  if (!toArgs.ref && !toArgs.selector && args.toX == null) {
    return fail('请提供 toRef/toSelector 或 toX/toY', 'invalid_arg')
  }

  let fromBox =
    args.fromX != null
      ? { ok: true as const, data: { x: Number(args.fromX), y: Number(args.fromY) } }
      : await sendWithRefRetry(tid, 'resolve_box', fromArgs)
  if (!fromBox?.ok) {
    const cdp = await cdpResolveBox(tid, {
      selector: String(fromArgs.selector || ''),
      name: String(fromArgs.ref || ''),
    }).catch(() => null)
    if (cdp) fromBox = { ok: true, data: cdp }
  }
  if (!fromBox?.ok) return fail(fromBox?.error || '无法定位拖拽起点', 'not_found')

  let toBox =
    args.toX != null
      ? { ok: true as const, data: { x: Number(args.toX), y: Number(args.toY) } }
      : await sendWithRefRetry(tid, 'resolve_box', toArgs)
  if (!toBox?.ok) {
    const cdp = await cdpResolveBox(tid, {
      selector: String(toArgs.selector || ''),
      name: String(toArgs.ref || ''),
    }).catch(() => null)
    if (cdp) toBox = { ok: true, data: cdp }
  }
  if (!toBox?.ok) return fail(toBox?.error || '无法定位拖拽终点', 'not_found')

  try {
    await debuggerMouseDrag(tid, fromBox.data, toBox.data, Number(args.steps) || 12)
    await sleep(80)
    return ok({
      from: fromBox.data,
      to: toBox.data,
      mode: 'pointer_drag',
    })
  } catch (e) {
    return fail('拖拽失败: ' + String((e as Error)?.message || e), 'drag_failed')
  }
}

export async function handleWait(tid: number, args: Record<string, unknown> = {}) {
  const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs) || 8000, 200), 40000)
  const pollMs = Math.min(Math.max(Number(args?.pollMs) || 120, 50), 1000)
  const started = Date.now()
  let last: { ok?: boolean; data?: any; error?: string } | null = null
  let injected = false
  while (Date.now() - started < timeoutMs) {
    if (!injected) {
      await ensureContent(tid)
      injected = true
    }
    const res = await sendToTab(tid, 'probe', args)
    last = res
    if (res?.ok && res.data?.matched) {
      return ok({
        matched: true,
        timedOut: false,
        waitedMs: Date.now() - started,
        observation: res.data,
      })
    }
    if (res && res.ok === false && /Receiving end|Could not establish|no_receiver/i.test(res.error || '')) {
      injected = false
    }
    await sleep(pollMs)
  }
  return ok({
    matched: false,
    timedOut: true,
    waitedMs: Date.now() - started,
    observation: last?.data || null,
    error: last?.ok === false ? last.error : undefined,
  })
}

import { fail, ok, type CmdResult } from '../shared/types'
import { cdpResolveBox, debuggerMouseClick, debuggerMouseDrag } from './debugger'
import { sendWithRefRetry } from './retry'
import { sleep } from './state'
import { ensureContent, focusTab, sendToTab, wantActivateWindow } from './tabs'
import { hasAxRef, maybeAttachSnapshot, resolveAxBox } from './ax_snapshot'
import { extractWaitFor, probeUntil } from './wait_for'

async function finishClick(
  tid: number,
  args: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<CmdResult> {
  const waitSpec = extractWaitFor(args)
  let out = { ...data }
  if (waitSpec) {
    const w = await probeUntil(tid, waitSpec)
    out = { ...out, wait: w }
    // waitFor 命中后默认 probe（快）；要继续点 @eN 时传 observation=ax
    out = await maybeAttachSnapshot(tid, args, out, {
      defaultMode: w.matched ? 'probe' : 'ax',
      settleMs: w.matched ? 0 : 60,
    })
  } else {
    // 无 waitFor：默认 ax，便于拿下一跳 ref
    out = await maybeAttachSnapshot(tid, args, out, { defaultMode: 'ax' })
  }
  return ok(out)
}

export async function handleClick(tid: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const mode = String(args?.mode || 'auto').toLowerCase()
  await focusTab(tid, wantActivateWindow(args))
  await ensureContent(tid)

  if (mode === 'dom') {
    const res = await sendWithRefRetry(tid, 'click', args)
    if (!res?.ok) return fail(res?.error || '点击失败', res?.code || 'click_failed')
    return finishClick(tid, args, { ...(res.data || {}), mode: 'dom', retried: (res as any).retried })
  }

  // AX 快照分配的 @eN：优先 CDP 取盒（不等同于 content data-ww-ref 时也能点）
  const refHint = String(args?.ref || args?.selector || '')
  if (hasAxRef(refHint) || hasAxRef(String(args?.ref || ''))) {
    const axBox = await resolveAxBox(tid, String(args?.ref || refHint)).catch(() => null)
    if (axBox) {
      try {
        await debuggerMouseClick(tid, axBox)
        return finishClick(tid, args, { ...axBox, mode: 'pointer', via: axBox.via || 'ax_ref' })
      } catch {
        /* 继续走 content / 名称兜底 */
      }
    }
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
    if (syn?.ok) return finishClick(tid, args, { ...(syn.data || {}), mode: 'dom' })
    return fail(box?.error || syn?.error || '无法定位元素', 'not_found')
  }

  try {
    await debuggerMouseClick(tid, box.data)
    return finishClick(tid, args, { ...(box.data || {}), mode: 'pointer', via, retried: (box as any).retried })
  } catch (e) {
    const err = String((e as Error)?.message || e)
    if (mode === 'pointer') {
      return fail('真指针点击失败: ' + err, 'pointer_failed')
    }
    const syn = await sendWithRefRetry(tid, 'click', args)
    if (syn?.ok) {
      return finishClick(tid, args, { ...(syn.data || {}), mode: 'dom', pointerError: err })
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
  // 独立 wait 仍默认 8s；内联 waitFor 默认 3s（见 extractWaitFor）
  const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs) || 8000, 200), 40000)
  const pollMs = Math.min(Math.max(Number(args?.pollMs) || 120, 50), 1000)
  const spec = {
    text: args.text != null && String(args.text) !== '' ? String(args.text) : undefined,
    textGone: args.textGone != null && String(args.textGone) !== '' ? String(args.textGone) : undefined,
    nameIncludes:
      args.nameIncludes != null && String(args.nameIncludes) !== ''
        ? String(args.nameIncludes)
        : undefined,
    ref: args.ref != null && String(args.ref) !== '' ? String(args.ref) : undefined,
    selector: args.selector != null && String(args.selector) !== '' ? String(args.selector) : undefined,
    readyState: args.readyState === true,
    frame: args.frame != null && String(args.frame) !== '' ? String(args.frame) : undefined,
    timeoutMs,
    pollMs,
  }
  if (
    !spec.text &&
    !spec.textGone &&
    !spec.nameIncludes &&
    !spec.ref &&
    !spec.selector &&
    !spec.readyState
  ) {
    return fail('wait 请提供 text / textGone / nameIncludes / ref / selector / readyState', 'invalid_arg')
  }
  const w = await probeUntil(tid, spec)
  const withObs = await maybeAttachSnapshot(tid, args, { ...w, wait: w }, {
    defaultMode: 'off',
    settleMs: 0,
  })
  return ok(withObs)
}

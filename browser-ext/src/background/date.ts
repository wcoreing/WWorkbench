import { fail, ok, type CmdResult } from '../shared/types'
import { sendWithRefRetry } from './retry'
import { sleep } from './state'
import { prepareWidgetTab, settleMs } from './widget'

type YMD = { y: number; mo: number; d: number; iso: string }

function parseYMD(raw: unknown): YMD | null {
  const s = String(raw || '').trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, mo, d, iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

/**
 * 日期：open → settle → 逐步翻月（带等待）→ pick。
 * 与 select 共用 prepare/settle；翻月循环是日期特有。
 */
export async function handleDateFill(tid: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const want = parseYMD(args?.value)
  if (!want) return fail('请提供 value（YYYY-MM-DD）', 'invalid_arg')

  await prepareWidgetTab(tid, args)

  const opened = await sendWithRefRetry(tid, 'fill', { ...args, value: want.iso, phase: 'open' })
  if (opened?.ok && (opened.data?.needPick === false || opened.data?.mode === 'date_native')) {
    return ok({ ...(opened.data || {}), mode: opened.data?.mode || 'date_native' })
  }
  if (!opened?.ok) {
    return fail(opened?.error || '无法打开日期面板（可 snapshot 后点日历）', opened?.code || 'date_open_failed')
  }

  await sleep(settleMs(args, 320))

  for (let i = 0; i < 36; i++) {
    const st = await sendWithRefRetry(tid, 'fill', { ...args, value: want.iso, phase: 'panel_state' })
    const curY = Number(st?.data?.y || 0)
    const curMo = Number(st?.data?.mo || 0)
    if (st?.ok && curY === want.y && curMo === want.mo) break
    if (!st?.ok || !curY || !curMo) break
    const dir = curY * 12 + curMo > want.y * 12 + want.mo ? 'prev' : 'next'
    const nav = await sendWithRefRetry(tid, 'fill', {
      ...args,
      value: want.iso,
      phase: 'nav_month',
      dir,
    })
    if (!nav?.ok) {
      return fail(nav?.error || '翻月失败（可 snapshot 点「上个月/下个月」）', nav?.code || 'date_nav_failed')
    }
    await sleep(140)
  }

  const picked = await sendWithRefRetry(tid, 'fill', {
    ...args,
    value: want.iso,
    phase: 'pick',
  })
  if (!picked?.ok) {
    return fail(picked?.error || '未点到日格（可 snapshot 后点 gridcell）', picked?.code || 'no_date_cell')
  }
  return ok({
    ...(picked.data || {}),
    opened: true,
    value: picked.data?.value || want.iso,
  })
}

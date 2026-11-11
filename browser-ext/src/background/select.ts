import { fail, ok, type CmdResult } from '../shared/types'
import { debuggerMouseClick } from './debugger'
import { sendWithRefRetry } from './retry'
import { sleep } from './state'
import { prepareWidgetTab, settleMs } from './widget'

/** Ant / Element 等自定义下拉：open → settle → pick（与 date 共用 prepare/settle）。 */
export async function handleSelectOption(tid: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const value = args?.value ?? args?.option ?? args?.label
  if (value == null || String(value) === '') {
    return fail('请提供 value/option（选项文案或值）', 'invalid_arg')
  }
  await prepareWidgetTab(tid, args)

  const probe = await sendWithRefRetry(tid, 'resolve_box', args)
  const opened = await sendWithRefRetry(tid, 'select_option', { ...args, value, phase: 'open' })
  if (opened?.ok && opened.data?.mode === 'select') {
    return ok(opened.data)
  }
  if (!opened?.ok && opened?.code !== 'custom_select') {
    if (probe?.ok) {
      const filled = await sendWithRefRetry(tid, 'fill', { ...args, value })
      if (filled?.ok) return ok({ ...(filled.data || {}), mode: filled.data?.mode || 'value' })
    }
    if (!opened?.ok) {
      return fail(opened?.error || '无法打开下拉（可 snapshot 后点）', opened?.code || 'select_failed')
    }
  }

  await sleep(settleMs(args, 280))

  const picked = await sendWithRefRetry(tid, 'select_option', {
    ...args,
    value,
    phase: 'pick',
  })
  if (!picked?.ok) {
    return fail(picked?.error || '打开了下拉但未匹配到选项（可 snapshot 后点 option）', picked?.code || 'no_option')
  }

  if (picked.data?.x != null && picked.data?.y != null) {
    try {
      await debuggerMouseClick(tid, picked.data)
    } catch {
      /* content 已 click */
    }
  }

  return ok({
    ...(picked.data || {}),
    opened: true,
    selected: picked.data?.label || value,
  })
}

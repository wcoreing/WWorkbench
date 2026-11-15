/**
 * 探索期多字段软写：fields[] 一次往返，失败即停。
 * 允许 fill / select_option；不含 Submit 等硬写。
 */
import { fail, ok, type CmdResult } from '../shared/types'
import { maybeAttachSnapshot } from './ax_snapshot'
import { handleDateFill } from './date'
import { handleSelectOption } from './select'
import { resolveTabId } from './tabs'

const MAX_FIELDS = 20

export type FillField = {
  ref?: string
  selector?: string
  name?: string
  value: string
  frame?: string
  /** fill（默认）| select_option */
  action?: string
}

type RunOneFill = (args: Record<string, unknown>) => Promise<CmdResult>

function normalizeFields(args: Record<string, unknown>): FillField[] | null {
  const raw = args.fields
  if (!Array.isArray(raw) || raw.length === 0) return null
  if (raw.length > MAX_FIELDS) {
    throw Object.assign(new Error(`fields 最多 ${MAX_FIELDS} 项`), { code: 'too_many_fields' })
  }
  const out: FillField[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = (raw[i] || {}) as Record<string, unknown>
    const value = item.value ?? item.option ?? item.label
    if (value == null || String(value) === '') {
      throw Object.assign(new Error(`fields[${i}] 缺 value`), { code: 'invalid_arg' })
    }
    const ref = String(item.ref || '').trim()
    const selector = String(item.selector || '').trim()
    const name = String(item.name || '').trim()
    if (!ref && !selector && !name) {
      throw Object.assign(new Error(`fields[${i}] 需 ref / selector / name`), { code: 'invalid_arg' })
    }
    const action = String(item.action || item.kind || 'fill')
      .trim()
      .toLowerCase()
    out.push({
      ref: ref || undefined,
      selector: selector || undefined,
      name: name || undefined,
      value: String(value),
      frame: String(item.frame || args.frame || '').trim() || undefined,
      action: action === 'select' || action === 'select_option' ? 'select_option' : 'fill',
    })
  }
  return out
}

/** 单字段 fill 后处理：自定义下拉 / 日期 / observation。 */
export async function finishSingleFill(
  tid: number,
  args: Record<string, unknown>,
  res: CmdResult,
): Promise<CmdResult> {
  if (!res.ok && (res as { code?: string }).code === 'custom_select') {
    return handleSelectOption(tid, args)
  }
  if (
    res.ok &&
    (res as { data?: { mode?: string; needPick?: boolean } }).data?.mode === 'date_picker' &&
    (res as { data?: { needPick?: boolean } }).data?.needPick
  ) {
    return handleDateFill(tid, args)
  }
  if (res.ok) {
    const data = (res.data || {}) as Record<string, unknown>
    const withObs = await maybeAttachSnapshot(tid, args, data, { defaultMode: 'off' })
    return ok(withObs)
  }
  return res
}

/**
 * 若有 fields[] 则批填；否则返回 null（走单字段路径）。
 * runOne：执行一次 content fill（含 focus/retry）。
 */
export async function tryHandleFillFields(
  args: Record<string, unknown>,
  runOne: RunOneFill,
): Promise<CmdResult | null> {
  let fields: FillField[] | null
  try {
    fields = normalizeFields(args)
  } catch (e) {
    const err = e as Error & { code?: string }
    return fail(err.message || 'fields 无效', err.code || 'invalid_arg')
  }
  if (!fields) return null

  const tid = await resolveTabId()
  if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')

  const results: Array<Record<string, unknown>> = []
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    const oneArgs: Record<string, unknown> = {
      ref: f.ref,
      selector: f.selector,
      name: f.name,
      value: f.value,
      frame: f.frame,
      // 批填中间项默认不带 observation，末项用外层 args
      includeSnapshot: false,
      observation: 'false',
    }
    let res: CmdResult
    if (f.action === 'select_option') {
      res = await handleSelectOption(tid, oneArgs)
    } else {
      res = await runOne(oneArgs)
      res = await finishSingleFill(tid, { ...oneArgs, includeSnapshot: false, observation: 'false' }, res)
    }
    const row: Record<string, unknown> = {
      index: i,
      action: f.action || 'fill',
      ref: f.ref,
      selector: f.selector,
      name: f.name,
      ok: !!res.ok,
    }
    if (res.ok && res.data) Object.assign(row, { data: res.data })
    if (!res.ok) {
      row.error = res.error
      row.code = (res as { code?: string }).code
      results.push(row)
      return ok({
        ok: false,
        batch: true,
        stoppedAt: i,
        count: fields.length,
        filled: i,
        results,
      })
    }
    results.push(row)
  }

  let out: Record<string, unknown> = {
    ok: true,
    batch: true,
    stoppedAt: null,
    count: fields.length,
    filled: fields.length,
    results,
  }
  // 整批成功后按外层 observation / includeSnapshot 附带（默认 off）
  out = await maybeAttachSnapshot(tid, args, out, { defaultMode: 'off' })
  return ok(out)
}

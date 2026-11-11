/** 页内 evaluate。 */
import { resolveContext } from './frames'

export function doEvaluate(args: any = {}) {
  const code = String(args?.code || '').trim()
  if (!code) return { ok: false, error: '请提供 code' }
  const ctx = resolveContext(args || {})
  const win = ctx.win || window
  let value: any
  try {
    value = win.eval(code)
  } catch (e1: any) {
    try {
      value = new win.Function('return (' + code + ')')()
    } catch {
      return { ok: false, error: String(e1?.message || e1) }
    }
  }
  let out = value
  try {
    out = JSON.parse(JSON.stringify(value))
  } catch {
    out = String(value)
  }
  return { ok: true, data: { type: typeof value, value: out, frame: ctx.frame } }
}

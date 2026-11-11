/** 日期控件：open / panel_state / nav_month / pick；框架细节在 adapters。 */
import {
  findAntDatePanel,
  findAntMonthNavBtn,
  isAntDateEditor,
  isAntDatePanel,
  pickAntDay,
  readAntYearMonth,
} from '../adapters/ant-date'
import {
  findElementDatePanel,
  findElementMonthNavBtn,
  isElementDateEditor,
  pickElementDay,
  readElementYearMonth,
} from '../adapters/element-date'
import { resolveContext } from '../frames'
import { boxOf, dispatchPointer, flash, prepareTarget } from '../target'
import { fillResultMeta, SNAPSHOT_HINT } from './meta'

export function parseDateValue(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, mo, d, iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

export function dateEditorRoot(el) {
  if (!el?.closest) return null
  if (isElementDateEditor(el) || isAntDateEditor(el)) {
    return (
      el.closest('.el-date-editor') ||
      el.closest('.el-date-picker') ||
      el.closest('.ant-picker') ||
      el.closest('.ant-picker-input') ||
      el
    )
  }
  return null
}

function findOpenDatePanel(doc) {
  return findElementDatePanel(doc) || findAntDatePanel(doc)
}

function readPanelYearMonth(panel) {
  if (isAntDatePanel(panel)) return readAntYearMonth(panel)
  return readElementYearMonth(panel)
}

function findMonthNavBtn(panel, dir) {
  if (isAntDatePanel(panel)) return findAntMonthNavBtn(panel, dir)
  return findElementMonthNavBtn(panel, dir)
}

/** Element / Ant 日期面板：phase=open|panel_state|nav_month|pick。 */
export function doDatePicker(args) {
  const want = parseDateValue(args?.value)
  if (!want && args?.phase !== 'panel_state' && args?.phase !== 'nav_month') {
    return { ok: false, error: '日期需 YYYY-MM-DD', code: 'bad_date' }
  }
  const ctx = resolveContext(args || {})
  const { doc, frame } = ctx

  if (args?.phase === 'panel_state') {
    const panel = findOpenDatePanel(doc)
    if (!panel) return { ok: false, error: '日期面板未打开', code: 'no_date_panel', data: { hint: SNAPSHOT_HINT } }
    const cur = readPanelYearMonth(panel)
    if (!cur) return { ok: false, error: '读不到面板年月', code: 'no_panel_ym', data: { hint: SNAPSHOT_HINT } }
    return { ok: true, data: { phase: 'panel_state', mode: 'date_picker', y: cur.y, mo: cur.mo, frame } }
  }

  if (args?.phase === 'nav_month') {
    const panel = findOpenDatePanel(doc)
    if (!panel) return { ok: false, error: '日期面板未打开', code: 'no_date_panel', data: { hint: SNAPSHOT_HINT } }
    const dir = args?.dir === 'next' ? 'next' : 'prev'
    const btn = findMonthNavBtn(panel, dir)
    if (!btn) return { ok: false, error: '找不到翻月按钮', code: 'no_month_nav', data: { hint: SNAPSHOT_HINT } }
    btn.click?.()
    const cur = readPanelYearMonth(panel)
    return {
      ok: true,
      data: { phase: 'nav_month', mode: 'date_picker', dir, y: cur?.y, mo: cur?.mo, frame },
    }
  }

  if (args?.phase === 'pick') {
    const panel = findOpenDatePanel(doc)
    if (!panel) return { ok: false, error: '日期面板未打开', code: 'no_date_panel', data: { hint: SNAPSHOT_HINT } }
    const okPick = isAntDatePanel(panel) ? pickAntDay(panel, want.iso) : pickElementDay(panel, want.d)
    if (!okPick) {
      return {
        ok: false,
        error: '未点到日期格: ' + want.iso,
        code: 'no_date_cell',
        data: { hint: SNAPSHOT_HINT },
      }
    }
    return {
      ok: true,
      data: { phase: 'pick', mode: 'date_picker', value: want.iso, frame },
    }
  }

  const got = prepareTarget(args)
  if (!got) return { ok: false, error: '未找到日期控件', data: { hint: SNAPSHOT_HINT } }
  const { el, win } = got
  const root = dateEditorRoot(el) || el
  const trigger =
    root.querySelector?.('input') ||
    (el.tagName === 'INPUT' ? el : null) ||
    root.querySelector?.('.el-input__wrapper, .ant-picker-input') ||
    root
  flash(trigger)
  trigger.focus?.()
  try {
    trigger.click?.()
  } catch {
    /* ignore */
  }
  dispatchPointer(trigger, win)
  const input = trigger.tagName === 'INPUT' ? trigger : trigger.querySelector?.('input')
  if (input && input.type === 'date') {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, want.iso)
    else input.value = want.iso
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return {
      ok: true,
      data: fillResultMeta(input, { mode: 'date_native', value: want.iso, frame, needPick: false }),
    }
  }
  const box = boxOf(trigger, got.frameEl)
  return {
    ok: true,
    data: {
      phase: 'open',
      mode: 'date_picker',
      needPick: true,
      value: want.iso,
      frame,
      x: box.x,
      y: box.y,
      hint: SNAPSHOT_HINT,
    },
  }
}

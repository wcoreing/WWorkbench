/** Ant Design 日期面板适配。 */
import { visible } from '../dom'
import { dispatchPointer, flash } from '../target'

export function isAntDateEditor(el) {
  if (!el?.closest) return false
  return !!(el.closest('.ant-picker') || el.closest('.ant-picker-input'))
}

export function findAntDatePanel(doc) {
  const sels = ['.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)', '.ant-picker-panel-container']
  for (const sel of sels) {
    try {
      const nodes = [...document.querySelectorAll(sel), ...(doc?.querySelectorAll?.(sel) || [])]
      for (const n of nodes) {
        if (visible(n)) return n.closest?.('.ant-picker-dropdown') || n
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

export function readAntYearMonth(panel) {
  const head = (panel.querySelector('.ant-picker-header-view')?.textContent || '').replace(/\s+/g, '')
  const ym = head.match(/(\d{4})年(\d{1,2})月/) || head.match(/(\d{4})[/-](\d{1,2})/)
  if (!ym) return null
  return { y: Number(ym[1]), mo: Number(ym[2]) }
}

export function findAntMonthNavBtn(panel, dir) {
  return dir === 'prev'
    ? panel.querySelector('button.ant-picker-header-prev-btn')
    : panel.querySelector('button.ant-picker-header-next-btn')
}

export function pickAntDay(panel, iso) {
  const cell =
    panel.querySelector(`.ant-picker-cell[title="${iso}"]`) ||
    panel.querySelector(`.ant-picker-cell-in-view[title="${iso}"]`)
  if (!cell) return false
  const inner = cell.querySelector('.ant-picker-cell-inner') || cell
  flash(inner)
  inner.click?.()
  cell.click?.()
  dispatchPointer(inner, window)
  return true
}

export function isAntDatePanel(panel) {
  return !!(
    panel?.querySelector?.('.ant-picker-panel, .ant-picker-cell') ||
    panel?.classList?.contains('ant-picker-dropdown')
  )
}

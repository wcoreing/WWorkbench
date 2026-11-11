/** Element Plus 日期面板适配。 */
import { visible } from '../dom'
import { dispatchPointer, flash } from '../target'

export function isElementDateEditor(el) {
  if (!el?.closest) return false
  return !!(el.closest('.el-date-editor') || el.closest('.el-date-picker'))
}

export function findElementDatePanel(doc) {
  const sels = [
    '.el-picker__popper:not([aria-hidden="true"]) .el-date-picker',
    '.el-picker__popper:not([style*="display: none"]) .el-date-picker',
    '.el-popper:not([aria-hidden="true"]) .el-date-picker',
    '.el-picker-panel',
    '.el-date-picker:not(.el-date-editor)',
  ]
  for (const sel of sels) {
    try {
      const nodes = [...document.querySelectorAll(sel), ...(doc?.querySelectorAll?.(sel) || [])]
      for (const n of nodes) {
        if (visible(n)) return n.closest?.('.el-picker__popper, .el-popper') || n
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

export function readElementYearMonth(panel) {
  let y = 0
  let mo = 0
  const nodes = [
    ...panel.querySelectorAll('.el-date-picker__header-label'),
    ...panel.querySelectorAll('.el-date-picker__header button, .el-picker-panel__icon-btn'),
  ]
  for (const lb of nodes) {
    const t = `${lb.getAttribute('aria-label') || ''}${lb.textContent || ''}`.replace(/\s+/g, '')
    const ym = t.match(/(\d{4})\s*年/)
    const mm = t.match(/(\d{1,2})\s*月/)
    if (ym) y = Number(ym[1])
    if (mm) mo = Number(mm[1])
  }
  if (!y || !mo) {
    const head = panel.querySelector('.el-date-picker__header, .el-picker-panel__body-wrapper, .el-date-picker')
    const t = (head?.textContent || '').replace(/\s+/g, '')
    const ym = t.match(/(\d{4})年.*?(\d{1,2})月/)
    if (ym) {
      y = Number(ym[1])
      mo = Number(ym[2])
    }
  }
  return y && mo ? { y, mo } : null
}

export function findElementMonthNavBtn(panel, dir) {
  const wantPrev = dir === 'prev'
  const ariaExact = wantPrev ? ['上个月', 'previous month', 'prev month'] : ['下个月', 'next month']
  const yearAria = ['前一年', '后一年', 'previous year', 'next year']
  const buttons = [...panel.querySelectorAll('button, .el-picker-panel__icon-btn, [role="button"]')]
  for (const btn of buttons) {
    const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''} ${btn.textContent || ''}`
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (yearAria.some((a) => label.includes(a.toLowerCase()))) continue
    if (ariaExact.some((a) => label === a.toLowerCase() || label.includes(a.toLowerCase()))) return btn
  }
  for (const btn of buttons) {
    const cls = String(btn.className || '')
    if (/d-arrow/.test(cls)) continue
    if (wantPrev && /(?:^|[\s_-])arrow-left(?:\s|$)|prev-btn/.test(cls) && !/year/i.test(cls)) return btn
    if (!wantPrev && /(?:^|[\s_-])arrow-right(?:\s|$)|next-btn/.test(cls) && !/year/i.test(cls)) return btn
  }
  return null
}

export function pickElementDay(panel, day) {
  const cells = [...panel.querySelectorAll('td.available, td.el-date-table__cell')]
  for (const td of cells) {
    if (td.classList?.contains('prev-month') || td.classList?.contains('next-month')) continue
    if (td.classList?.contains('el-date-table__cell--prev-month') || td.classList?.contains('el-date-table__cell--next-month'))
      continue
    const span = td.querySelector('span') || td
    const n = Number((span.textContent || '').trim())
    if (n !== day) continue
    if (!visible(td) && !visible(span)) continue
    flash(span)
    span.click?.()
    td.click?.()
    dispatchPointer(span, window)
    return true
  }
  return false
}

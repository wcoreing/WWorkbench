/** Ant / Element / ARIA 下拉选项定位。 */
import { deepQueryAll, visible } from '../dom'

const OPTION_SELECTORS = [
  '.ant-select-item-option:not(.ant-select-item-option-disabled)',
  '.ant-select-item-option-content',
  '.el-select-dropdown__item:not(.is-disabled)',
  '.el-vl__window .el-select-dropdown__item',
  '[role="listbox"] [role="option"]',
  '[role="option"]',
  '.rc-virtual-list-holder-inner .ant-select-item-option',
].join(',')

export function findDropdownOption(doc, want) {
  const q = String(want || '').trim()
  if (!q) return null
  const qLower = q.toLowerCase()
  const cands = deepQueryAll(doc, OPTION_SELECTORS)
  const extras = []
  try {
    document.querySelectorAll(OPTION_SELECTORS).forEach((n) => extras.push(n))
  } catch {
    /* ignore */
  }
  const scored = []
  for (const el of [...cands, ...extras]) {
    if (!visible(el)) continue
    const text = (el.innerText || el.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
    const val = el.getAttribute('data-value') || el.getAttribute('value') || ''
    if (!text && !val) continue
    let score = 0
    if (text === q || val === q) score = 100
    else if (text.toLowerCase() === qLower) score = 90
    else if (text.includes(q) || val.includes(q)) score = 60
    else if (text.toLowerCase().includes(qLower)) score = 40
    if (score > 0) scored.push({ el, text, val, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored[0] || null
}

export function isCustomSelectTrigger(el) {
  if (!el) return false
  if (el.tagName === 'SELECT') return false
  if (el.getAttribute('role') === 'combobox') return true
  if (el.getAttribute('aria-haspopup') === 'listbox') return true
  if (el.classList?.contains('ant-select-selector') || el.classList?.contains('ant-select-selection-search-input'))
    return true
  if (el.classList?.contains('el-select') || el.classList?.contains('el-select__wrapper') || el.classList?.contains('el-input__wrapper')) {
    return !!el.closest?.('.el-select') || el.classList.contains('el-select')
  }
  return !!(el.closest?.('.ant-select') || el.closest?.('.el-select') || el.closest?.('[role="combobox"]'))
}

export function customSelectRoot(el) {
  return el.closest?.('.ant-select') || el.closest?.('.el-select') || el.closest?.('[role="combobox"]') || el
}

export function resolveSelectTrigger(el) {
  const root = customSelectRoot(el)
  return (
    root.querySelector?.('.ant-select-selector, .el-select__wrapper, .el-input__wrapper, [role="combobox"]') ||
    (el.classList?.contains('ant-select-selection-search-input') ? root.querySelector('.ant-select-selector') : null) ||
    root
  )
}

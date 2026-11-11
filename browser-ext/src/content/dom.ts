/** DOM 工具：可见性、标签、Shadow 穿透、可交互列表。 */
export const INTERACTIVE =
  'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="option"],[role="tab"],[role="switch"],[role="gridcell"],[contenteditable=""],[contenteditable="true"],.ant-btn,.el-button,.ant-menu-item,.ProseMirror,.ql-editor,.tox-edit-area,__ww-ce'

/** 日期面板日格（Element / Ant）：不是 button，默认 INTERACTIVE 收不到。 */
export const DATE_CELL =
  '.el-date-table td.available,.el-date-table td.el-date-table__cell:not(.disabled),' +
  '.el-month-table td .cell,.el-year-table td .cell,' +
  '.ant-picker-cell-in-view:not(.ant-picker-cell-disabled),' +
  'td[class*="available"],.el-picker-panel td.available'

export function visible(el) {
  if (!el || el.hidden) return false
  const st = el.ownerDocument.defaultView.getComputedStyle(el)
  if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

export function labelOf(el) {
  const aria = (el.getAttribute('aria-label') || '').trim()
  if (aria) return aria.slice(0, 80)
  const title = (el.getAttribute('title') || '').trim()
  if (title) return title.slice(0, 80)
  // Ant 日期格 title=YYYY-MM-DD；Element 格只有日号
  if (el.classList?.contains('ant-picker-cell') || el.closest?.('.el-date-table')) {
    const day = (el.querySelector?.('.ant-picker-cell-inner, span, .cell') || el).textContent || ''
    const d = day.replace(/\s+/g, ' ').trim()
    if (title) return title.slice(0, 80)
    if (d) return d.slice(0, 80)
  }
  const ph = (el.getAttribute('placeholder') || '').trim()
  if (ph) return ph.slice(0, 80)
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.classList?.contains('ProseMirror') || el.classList?.contains('ql-editor')) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
    return (t || '富文本').slice(0, 80)
  }
  const ant = el.querySelector?.('.ant-btn-icon + span, .ant-menu-title-content, span:not(.anticon)')
  if (ant) {
    const t = (ant.innerText || ant.textContent || '').replace(/\s+/g, ' ').trim()
    if (t && t.toLowerCase() !== 'button') return t.slice(0, 80)
  }
  const name = (el.getAttribute('name') || '').trim()
  if (name) return name.slice(0, 80)
  const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  if (t && t.toLowerCase() !== 'button') return t.slice(0, 80)
  return el.tagName.toLowerCase()
}

export function roleOf(el) {
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.classList?.contains('ProseMirror') || el.classList?.contains('ql-editor')) {
    return 'textbox'
  }
  if (
    el.classList?.contains('ant-picker-cell') ||
    el.classList?.contains('available') ||
    el.closest?.('.el-date-table') ||
    el.getAttribute('role') === 'gridcell'
  ) {
    return 'gridcell'
  }
  return (
    el.getAttribute('role') ||
    (el.tagName === 'A'
      ? 'link'
      : el.tagName === 'BUTTON'
        ? 'button'
        : el.tagName === 'INPUT'
          ? el.type || 'input'
          : el.tagName === 'TEXTAREA'
            ? 'textbox'
            : el.tagName.toLowerCase())
  )
}

export function deepQueryAll(root, selector) {
  const out = []
  const visit = (node) => {
    if (!node) return
    try {
      if (node.querySelectorAll) {
        node.querySelectorAll(selector).forEach((el) => out.push(el))
      }
    } catch {
      /* invalid selector in this root */
    }
    let children
    try {
      children = node.querySelectorAll ? node.querySelectorAll('*') : []
    } catch {
      children = []
    }
    for (const el of children) {
      if (el.shadowRoot) visit(el.shadowRoot)
    }
  }
  visit(root)
  return out
}

export function deepQuery(root, selector) {
  const all = deepQueryAll(root, selector)
  return all[0] || null
}

function pushInteractive(out, seen, el) {
  if (!el || !visible(el) || seen.has(el)) return
  for (const prev of out) {
    try {
      if (prev.contains?.(el)) return
    } catch {
      /* cross-root */
    }
  }
  seen.add(el)
  out.push(el)
}

/** 打开中的日期/下拉浮层优先，避免侧栏占满 maxNodes 把日格截掉。 */
function openOverlayRoots(doc) {
  const sels = [
    '.el-picker__popper:not([aria-hidden="true"])',
    '.el-popper:not([aria-hidden="true"])',
    '.el-select-dropdown:not([style*="display: none"])',
    '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  ]
  const roots = []
  for (const sel of sels) {
    try {
      for (const n of [...document.querySelectorAll(sel), ...deepQueryAll(doc, sel)]) {
        if (visible(n)) roots.push(n)
      }
    } catch {
      /* ignore */
    }
  }
  return roots
}

export function interactiveList(doc) {
  const seen = new Set()
  const out = []
  const selector = INTERACTIVE.replace(',__ww-ce', '')
  // 1) 浮层内：按钮 + 日期格优先
  for (const root of openOverlayRoots(doc)) {
    for (const el of deepQueryAll(root, selector)) pushInteractive(out, seen, el)
    for (const el of deepQueryAll(root, DATE_CELL)) pushInteractive(out, seen, el)
  }
  // 2) 文档其余可交互
  for (const el of deepQueryAll(doc, selector)) pushInteractive(out, seen, el)
  // 3) 文档内残留日期格（少数挂在非 popper 容器）
  for (const el of deepQueryAll(doc, DATE_CELL)) pushInteractive(out, seen, el)
  return out
}


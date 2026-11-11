/** 页面用户操作捕获：仅 isTrusted 事件；产出稳定 locator。 */
import { labelOf, roleOf, visible } from './dom'

let enabled = false
let session = ''
let lastFillAt = 0
let lastClickKey = ''
let lastClickAt = 0

function cssEscapeIdent(s: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s)
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/** 尽量稳定的 CSS selector（优先 id / name / data-*）。 */
export function stableSelector(el: Element): string {
  const html = el as HTMLElement
  const id = html.id?.trim()
  if (id && /^[A-Za-z][\w:-]*$/.test(id)) {
    try {
      if (html.ownerDocument.querySelectorAll(`#${cssEscapeIdent(id)}`).length === 1) {
        return `#${cssEscapeIdent(id)}`
      }
    } catch {
      /* ignore */
    }
  }
  const tag = html.tagName.toLowerCase()
  const name = html.getAttribute('name')?.trim()
  if (name) {
    const sel = `${tag}[name="${name.replace(/"/g, '\\"')}"]`
    try {
      if (html.ownerDocument.querySelectorAll(sel).length === 1) return sel
    } catch {
      /* ignore */
    }
  }
  for (const attr of ['data-testid', 'data_value', 'data-id', 'aria-label']) {
    const v = html.getAttribute(attr)?.trim()
    if (!v) continue
    const sel = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`
    try {
      if (html.ownerDocument.querySelectorAll(sel).length === 1) return sel
    } catch {
      /* ignore */
    }
  }
  // 短路径：最多 4 层
  const parts: string[] = []
  let cur: Element | null = html
  for (let i = 0; i < 4 && cur && cur.nodeType === 1; i++) {
    const t = cur.tagName.toLowerCase()
    if (cur.id && /^[A-Za-z][\w:-]*$/.test(cur.id)) {
      parts.unshift(`#${cssEscapeIdent(cur.id)}`)
      break
    }
    const parent = cur.parentElement
    if (!parent) {
      parts.unshift(t)
      break
    }
    const siblings = [...parent.children].filter((c) => c.tagName === cur!.tagName)
    if (siblings.length > 1) {
      const idx = siblings.indexOf(cur) + 1
      parts.unshift(`${t}:nth-of-type(${idx})`)
    } else {
      parts.unshift(t)
    }
    cur = parent
    if (t === 'body' || t === 'html') break
  }
  return parts.join(' > ')
}

function emit(step: {
  action: string
  summary: string
  locator: Record<string, unknown>
  args?: Record<string, unknown>
}) {
  if (!enabled) return
  try {
    chrome.runtime.sendMessage({
      channel: 'ww-record',
      kind: 'step',
      session,
      ...step,
      url: location.href,
    })
  } catch {
    /* ignore */
  }
}

/** 是否像可点控件（含藏宝阁 li[data_value] 等自定义项）。 */
function looksClickable(el: HTMLElement): boolean {
  const tag = el.tagName
  if (
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    tag === 'LABEL' ||
    tag === 'SUMMARY' ||
    el.isContentEditable
  ) {
    return true
  }
  const role = el.getAttribute('role') || ''
  if (
    role === 'button' ||
    role === 'link' ||
    role === 'tab' ||
    role === 'menuitem' ||
    role === 'option' ||
    role === 'checkbox' ||
    role === 'radio' ||
    role === 'treeitem' ||
    role === 'listitem'
  ) {
    return true
  }
  if (el.classList?.contains('ant-btn') || el.classList?.contains('el-button')) return true
  // 藏宝阁 / 自定义列表项
  if (el.hasAttribute('data_value') || el.hasAttribute('data-value') || el.hasAttribute('data-testid')) return true
  if (tag === 'LI' && (el.hasAttribute('data_value') || el.hasAttribute('data-value') || el.onclick)) return true
  const tabindex = el.getAttribute('tabindex')
  if (tabindex != null && tabindex !== '' && Number(tabindex) >= 0) return true
  if (el.getAttribute('onclick') || typeof el.onclick === 'function') return true
  try {
    if (getComputedStyle(el).cursor === 'pointer') return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 从点击目标向上找最合适的可点节点。
 * 优先带 data_value 的项（藏宝阁选项），再语义控件，最后 pointer 祖先。
 */
function interactiveFrom(el: EventTarget | null): HTMLElement | null {
  let cur = el as HTMLElement | null
  let pointerFallback: HTMLElement | null = null
  let anyFallback: HTMLElement | null = null
  for (let i = 0; i < 12 && cur; i++) {
    if (cur.nodeType !== 1) {
      cur = cur.parentElement
      continue
    }
    if (cur.tagName === 'BODY' || cur.tagName === 'HTML') break
    if (!visible(cur)) {
      cur = cur.parentElement
      continue
    }
    if (!anyFallback) anyFallback = cur
    if (cur.hasAttribute('data_value') || cur.hasAttribute('data-value')) {
      return cur
    }
    if (looksClickable(cur)) {
      // pointer-only 先记下，继续向上找更语义的（如外层 li）
      try {
        const onlyPointer =
          getComputedStyle(cur).cursor === 'pointer' &&
          !['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'LI'].includes(cur.tagName) &&
          !cur.getAttribute('role') &&
          !cur.hasAttribute('data_value') &&
          !cur.hasAttribute('data-value')
        if (onlyPointer) {
          if (!pointerFallback) pointerFallback = cur
        } else {
          return cur
        }
      } catch {
        return cur
      }
    }
    cur = cur.parentElement
  }
  return pointerFallback || anyFallback
}

function onClick(ev: MouseEvent) {
  if (!enabled || !ev.isTrusted) return
  const el = interactiveFrom(ev.target)
  if (!el) return
  // 输入框点击不记 click（等 change/fill）
  const tag = el.tagName
  const type = (el as HTMLInputElement).type || ''
  if (tag === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(type)) return
  if (tag === 'TEXTAREA' || el.isContentEditable) return
  // 点到空白大容器（无文案且无 data_value）不记，减少噪音
  const name = labelOf(el)
  const dataValue = el.getAttribute('data_value') || el.getAttribute('data-value') || ''
  if (!name && !dataValue && (tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION')) return

  const selector = stableSelector(el)
  const key = `${selector}|${name}|${dataValue}`
  const now = Date.now()
  if (key === lastClickKey && now - lastClickAt < 400) return
  lastClickKey = key
  lastClickAt = now

  const locator: Record<string, unknown> = {
    selector,
    name,
    role: roleOf(el),
    url: location.href,
  }
  if (dataValue) locator.data_value = dataValue
  const args: Record<string, unknown> = { selector, name }
  if (dataValue) args.data_value = dataValue

  emit({
    action: 'click',
    summary: name ? `点击 ${name}` : dataValue ? `点击 ${dataValue}` : `点击 ${selector}`,
    locator,
    args,
  })
}

function readValue(el: HTMLElement): string {
  if (el.tagName === 'SELECT') {
    const sel = el as HTMLSelectElement
    const opt = sel.selectedOptions?.[0]
    return (opt?.textContent || sel.value || '').trim().slice(0, 200)
  }
  if (el.isContentEditable) return (el.innerText || '').trim().slice(0, 200)
  return String((el as HTMLInputElement).value || '').slice(0, 200)
}

function onChange(ev: Event) {
  if (!enabled || !(ev as Event).isTrusted) return
  const el = interactiveFrom(ev.target) || (ev.target as HTMLElement)
  if (!el) return
  const tag = el.tagName
  const type = (el as HTMLInputElement).type || ''
  // checkbox/radio 走 click，避免与 change 双记
  if (tag === 'INPUT' && ['button', 'submit', 'reset', 'file', 'checkbox', 'radio'].includes(type)) return
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !el.isContentEditable) return

  const now = Date.now()
  if (now - lastFillAt < 200) return
  lastFillAt = now

  const name = labelOf(el)
  const selector = stableSelector(el)
  const value = readValue(el)
  emit({
    action: tag === 'SELECT' ? 'select_option' : 'fill',
    summary: name ? `填写 ${name}` : `填写 ${selector}`,
    locator: { selector, name, role: roleOf(el), url: location.href },
    args: { selector, name, value },
  })
}

function onSubmit(ev: Event) {
  if (!enabled || !(ev as Event).isTrusted) return
  const form = ev.target as HTMLFormElement
  if (!form || form.tagName !== 'FORM') return
  const selector = stableSelector(form)
  emit({
    action: 'click',
    summary: '提交表单',
    locator: { selector, name: labelOf(form) || 'form', role: 'form', url: location.href },
    args: { selector, submit: true },
  })
}

export function enableRecording(sess: string) {
  session = sess || ''
  if (enabled) return { ok: true, data: { recording: true, session } }
  enabled = true
  document.addEventListener('click', onClick, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('submit', onSubmit, true)
  return { ok: true, data: { recording: true, session } }
}

export function disableRecording() {
  if (!enabled) return { ok: true, data: { recording: false } }
  enabled = false
  session = ''
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('change', onChange, true)
  document.removeEventListener('submit', onSubmit, true)
  return { ok: true, data: { recording: false } }
}

export function recordingStatus() {
  return { recording: enabled, session }
}

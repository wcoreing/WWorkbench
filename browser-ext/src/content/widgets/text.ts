/** 原生 input/textarea + 富文本。 */
import { fillResultMeta } from './meta'

export function isRichEditable(el) {
  if (!el) return false
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true
  if (el.classList?.contains('ProseMirror') || el.classList?.contains('ql-editor')) return true
  if (el.getAttribute('role') === 'textbox' && el.getAttribute('contenteditable') != null) return true
  return false
}

export function fillRichText(el, value, win, doc) {
  el.focus?.()
  const w = win || window
  const d = doc || document
  try {
    const sel = w.getSelection?.()
    if (sel) {
      const range = d.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  } catch {
    /* ignore */
  }
  let mode = 'contenteditable'
  let ok = false
  try {
    ok = d.execCommand?.('insertText', false, value)
  } catch {
    ok = false
  }
  if (!ok) {
    el.textContent = value
    mode = 'textContent'
  }
  try {
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value,
      }),
    )
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return mode
}

/** 解析嵌套 contenteditable / TinyMCE iframe。 */
export function resolveEditableTarget(el, win, doc) {
  if (isRichEditable(el)) return { el, win, doc }
  const inner =
    el.querySelector?.('[contenteditable="true"], .ProseMirror, .ql-editor') || el.querySelector?.('iframe')
  if (inner && inner.tagName === 'IFRAME') {
    try {
      const idoc = inner.contentDocument
      const body = idoc?.body
      if (body && (body.isContentEditable || body.getAttribute('contenteditable') === 'true')) {
        return { el: body, win: idoc.defaultView, doc: idoc }
      }
    } catch {
      /* cross-origin */
    }
  } else if (inner) {
    return { el: inner, win, doc }
  }
  return { el, win, doc }
}

export function fillNativeValue(el, value, frame) {
  el.focus?.()
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
  return {
    ok: true,
    data: fillResultMeta(el, {
      mode: 'value',
      value: String(el.value || '').slice(0, 60),
      frame,
    }),
  }
}

export function fillNativeSelect(el, value, frame) {
  const want = String(value)
  const opts = [...(el.options || [])]
  const opt =
    opts.find((o) => o.value === want) ||
    opts.find((o) => (o.text || '').trim() === want) ||
    opts.find((o) => (o.label || '').trim() === want) ||
    opts.find((o) => (o.text || '').includes(want) || String(o.value || '').includes(want))
  if (!opt && want !== '') {
    return {
      ok: false,
      error: '无匹配 option: ' + want.slice(0, 40) + '（可用 snapshot 看 options）',
      code: 'no_option',
      data: { hint: 'snapshot_then_click' },
    }
  }
  el.focus?.()
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  const nextVal = opt ? opt.value : ''
  if (setter) setter.call(el, nextVal)
  else el.value = nextVal
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return {
    ok: true,
    data: fillResultMeta(el, {
      mode: 'select',
      value: String(el.value || '').slice(0, 60),
      label: opt ? String(opt.text || '').slice(0, 80) : '',
      frame,
    }),
  }
}

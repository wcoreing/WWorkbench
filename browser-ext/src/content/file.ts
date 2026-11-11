/** file input 定位。 */
import { deepQuery } from './dom'
import { resolveContext } from './frames'
import { buildSnapshot, findTarget } from './snapshot'

export function resolveFileInput(args) {
  const ctx = resolveContext(args || {})
  const { doc, frame } = ctx
  if (args?.ref && !deepQuery(doc, `[data-ww-ref="${String(args.ref).replace(/"/g, '\\"')}"]`)) {
    buildSnapshot({ ...args, frame, maxNodes: args?.maxNodes || 200 })
  }
  let el = findTarget(doc, args)
  if (el && el.tagName !== 'INPUT') {
    const nested = el.querySelector?.('input[type="file"]') || deepQuery(el, 'input[type="file"]')
    if (nested) el = nested
    else {
      const lab = el.closest?.('label')
      if (lab) {
        const forId = lab.getAttribute('for')
        if (forId) el = doc.getElementById(forId) || el
        else el = lab.querySelector('input[type="file"]') || el
      }
    }
  }
  if (!el) {
    el = deepQuery(doc, 'input[type="file"]')
  }
  if (!el || el.tagName !== 'INPUT' || String(el.type).toLowerCase() !== 'file') {
    return { ok: false, error: '未找到 input[type=file]，请先 snapshot/find 上传控件', code: 'not_found' }
  }
  const ref = el.getAttribute('data-ww-ref') || ''
  if (!ref) {
    el.setAttribute('data-ww-upload', '1')
  }
  return {
    ok: true,
    data: {
      tag: 'input',
      type: 'file',
      ref: ref || undefined,
      name: el.getAttribute('name') || '',
      accept: el.getAttribute('accept') || '',
      multiple: !!el.multiple,
      frame,
      marked: !ref,
      url: location.href,
    },
  }
}


/** 定位目标、高亮、坐标。 */
import { deepQuery, visible } from './dom'
import { resolveContext } from './frames'
import { buildSnapshot, findTarget } from './snapshot'

export function clickableTarget(el) {
  if (!el) return null
  if (el.getAttribute('role') === 'menuitem') {
    const menuTitle = el.querySelector?.('.ant-menu-title-content, a, button')
    if (menuTitle && visible(menuTitle)) return menuTitle
  }
  const btn = el.closest?.('button, [role="button"], .ant-btn, a[href]')
  if (btn && visible(btn)) return btn
  return el
}

export function flash(el) {
  try {
    const prev = el.getAttribute('style') || ''
    el.setAttribute(
      'style',
      prev +
        ';outline:3px solid #ff4d4f!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(255,77,79,.35)!important;',
    )
    setTimeout(() => {
      if (prev) el.setAttribute('style', prev)
      else el.removeAttribute('style')
    }, 900)
  } catch {
    /* ignore */
  }
}

export function boxOf(el, frameEl) {
  const r = el.getBoundingClientRect()
  let ox = 0
  let oy = 0
  if (frameEl) {
    const fr = frameEl.getBoundingClientRect()
    ox = fr.left
    oy = fr.top
  }
  const x = ox + r.left + Math.min(Math.max(r.width / 2, 2), Math.max(r.width - 2, 2))
  const y = oy + r.top + Math.min(Math.max(r.height / 2, 2), Math.max(r.height - 2, 2))
  return { x, y, width: r.width, height: r.height, top: oy + r.top, left: ox + r.left }
}

export function dispatchPointer(el, win) {
  const b = boxOf(el, null)
  const opts = {
    bubbles: true,
    cancelable: true,
    view: win || window,
    clientX: b.x,
    clientY: b.y,
    buttons: 1,
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      el.dispatchEvent(new MouseEvent(type, opts))
    } catch {
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    }
  }
}

export function prepareTarget(args) {
  const ctx = resolveContext(args || {})
  const { doc, win, frameEl, frame } = ctx
  const refSel = args?.ref ? `[data-ww-ref="${String(args.ref).replace(/"/g, '\\"')}"]` : ''
  if (args?.ref && !deepQuery(doc, refSel)) {
    buildSnapshot({ ...args, frame, maxNodes: args?.maxNodes || 200 })
  }
  const raw = findTarget(doc, args)
  if (!raw) return null
  const el = clickableTarget(raw)
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
  } catch {
    /* ignore */
  }
  return { el, doc, win, frameEl, frame }
}


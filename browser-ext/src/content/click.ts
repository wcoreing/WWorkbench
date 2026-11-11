/** 点击与 resolve_box。 */
import { labelOf } from './dom'
import { boxOf, dispatchPointer, flash, prepareTarget } from './target'

export function resolveBox(args) {
  const got = prepareTarget(args)
  if (!got) return { ok: false, error: '未找到元素 ' + (args?.ref || args?.selector || '') }
  const { el, frameEl, frame } = got
  flash(el)
  const box = boxOf(el, frameEl)
  return {
    ok: true,
    data: {
      ...box,
      tag: el.tagName.toLowerCase(),
      text: labelOf(el),
      url: location.href,
      title: document.title,
      frame,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
    },
  }
}

export function doClick(args) {
  const got = prepareTarget(args)
  if (!got) return { ok: false, error: '未找到元素 ' + (args?.ref || args?.selector || '') }
  const { el, win, frameEl, frame } = got
  flash(el)
  el.focus?.()
  try {
    el.click()
  } catch {
    /* ignore */
  }
  dispatchPointer(el, win)
  const box = boxOf(el, frameEl)
  return {
    ok: true,
    data: {
      tag: el.tagName.toLowerCase(),
      text: labelOf(el),
      url: location.href,
      mode: 'dom',
      frame,
      x: box.x,
      y: box.y,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
    },
  }
}


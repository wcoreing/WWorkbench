/** 键盘输入。 */
import { resolveContext } from './frames'
import { prepareTarget } from './target'

export const NAMED_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
}

export function dispatchKey(target, def, mods, win) {
  const opts = {
    key: def.key,
    code: def.code,
    keyCode: def.keyCode,
    which: def.keyCode,
    bubbles: true,
    cancelable: true,
    view: win || window,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  }
  for (const type of ['keydown', 'keypress', 'keyup']) {
    if (type === 'keypress' && def.key.length > 1 && def.key !== 'Enter') continue
    target.dispatchEvent(new KeyboardEvent(type, opts))
  }
}

export function doKeys(args) {
  const ctx = resolveContext(args || {})
  let target = ctx.doc.activeElement || ctx.doc.body
  let win = ctx.win
  if (args?.ref || args?.selector) {
    const got = prepareTarget(args)
    if (!got) return { ok: false, error: '未找到要聚焦的元素' }
    got.el.focus?.()
    target = got.el
    win = got.win
  }
  const raw = String(args?.keys || '').trim()
  if (!raw) return { ok: false, error: '请提供 keys（如 Enter、Escape、Mod+A）' }
  const repeat = Math.min(Math.max(Number(args?.repeat) || 1, 1), 20)
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean)
  const mods = { ctrl: false, meta: false, alt: false, shift: false }
  const keyToken = parts[parts.length - 1] || raw
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i].toLowerCase()
    if (p === 'mod') {
      if (isMac) mods.meta = true
      else mods.ctrl = true
    } else if (p === 'meta' || p === 'cmd' || p === 'command') mods.meta = true
    else if (p === 'ctrl' || p === 'control') mods.ctrl = true
    else if (p === 'alt' || p === 'option') mods.alt = true
    else if (p === 'shift') mods.shift = true
  }
  const named = NAMED_KEYS[keyToken]
  const def = named || {
    key: keyToken.length === 1 ? keyToken : keyToken,
    code: keyToken.length === 1 ? 'Key' + keyToken.toUpperCase() : keyToken,
    keyCode: keyToken.length === 1 ? keyToken.toUpperCase().charCodeAt(0) : 0,
  }
  for (let i = 0; i < repeat; i++) dispatchKey(target, def, mods, win)
  return {
    ok: true,
    data: {
      keys: raw,
      repeat,
      tag: target.tagName?.toLowerCase?.() || 'body',
      url: location.href,
      frame: ctx.frame,
    },
  }
}

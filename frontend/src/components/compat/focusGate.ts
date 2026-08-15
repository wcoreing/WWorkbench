import { dismissOverlays } from './dismissOverlays'

/** 抢焦内容区（xterm / Monaco 等）。 */
export const FOCUS_HOG_ATTR = 'data-ww-focus-hog'
/** 命令壳（产品轨 / 顶栏）。 */
export const CHROME_ATTR = 'data-ww-chrome'

/** 仅显式 chrome：浮层盖住轨时按坐标转发。 */
const CHROME_POINT_SEL = `[${CHROME_ATTR}]`
const HOG_SEL = `[${FOCUS_HOG_ATTR}]`
/** 命令控件：首击应执行，不能只用来失焦。 */
const COMMAND_SEL =
  'button, [role="button"], [data-product-id], .wn-select-trigger, a[href]'

/** chromeProps 挂在命令壳根节点。 */
export function chromeProps(): Record<string, string> {
  return { [CHROME_ATTR]: '' }
}

/** focusHogProps 挂在抢焦宿主根节点。 */
export function focusHogProps(): Record<string, string> {
  return { [FOCUS_HOG_ATTR]: '' }
}

/** registerFocusHog 命令式标记抢焦宿主；返回清理函数。 */
export function registerFocusHog(el: HTMLElement | null): () => void {
  if (!el) return () => {}
  el.setAttribute(FOCUS_HOG_ATTR, '')
  return () => el.removeAttribute(FOCUS_HOG_ATTR)
}

/** 内容区持焦：路径输入、xterm、Monaco、产品内可编辑控件等。 */
function isContentFocus(ae: HTMLElement): boolean {
  if (ae === document.body || ae === document.documentElement) return false
  if (ae.classList.contains('xterm-helper-textarea')) return true
  if (ae.closest(HOG_SEL)) return true
  if (ae.closest('.monaco-editor, .xterm')) return true
  if (!ae.closest('.workbench-shell')) return false
  const tag = ae.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return ae.isContentEditable
}

function blurActive() {
  const ae = document.activeElement
  if (ae instanceof HTMLElement) ae.blur()
}

function findCommandControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest(COMMAND_SEL)
  return el instanceof HTMLElement ? el : null
}

/**
 * 内容持焦时点到外部命令：应释放焦点。
 * 不含「点在同一命令上」（二次点击关 Select 等）。
 */
function shouldReleaseForCommand(command: HTMLElement): boolean {
  const ae = document.activeElement
  if (!(ae instanceof HTMLElement)) return false
  if (!isContentFocus(ae)) return false
  if (ae === command || command.contains(ae)) return false
  const surface = ae.closest(`${HOG_SEL}, .monaco-editor, .xterm`)
  if (surface && surface.contains(command)) return false
  return true
}

function chromeAtPoint(x: number, y: number): HTMLElement | null {
  const nodes = document.querySelectorAll(CHROME_POINT_SEL)
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    const r = node.getBoundingClientRect()
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return node
  }
  return null
}

/** 穿透浮层，取 chrome 下真正的命令控件。 */
function findChromeControl(chrome: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof Element)) continue
    if (!chrome.contains(el)) continue
    const control = el.closest(COMMAND_SEL)
    if (control instanceof HTMLElement && chrome.contains(control)) return control
  }
  return null
}

function retargetPointer(control: HTMLElement, e: PointerEvent) {
  control.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
      view: window,
    }),
  )
}

let installed = false

/**
 * installFocusGate — 捕获阶段保证命令首击必达。
 *
 * 1. 内容持焦（Monaco/xterm/input）点到按钮/Select：先 blur，再让 pressProps 执行
 * 2. 浮层盖住显式 chrome（产品轨/顶栏）：dismiss + 转发给下方控件
 */
export function installFocusGate(): () => void {
  if (installed) return () => {}
  installed = true

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return

    const targetInChrome =
      e.target instanceof Element && !!e.target.closest(CHROME_POINT_SEL)
    if (!targetInChrome) {
      const chrome = chromeAtPoint(e.clientX, e.clientY)
      if (chrome) {
        const control = findChromeControl(chrome, e.clientX, e.clientY)
        if (control) {
          if (shouldReleaseForCommand(control)) blurActive()
          e.preventDefault()
          e.stopImmediatePropagation()
          dismissOverlays()
          retargetPointer(control, e)
          return
        }
      }
    }

    const command = findCommandControl(e.target)
    if (command && shouldReleaseForCommand(command)) {
      blurActive()
      // 取消「仅焦移」；不 stop，让目标 pressProps / Select 同事件执行
      e.preventDefault()
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    installed = false
  }
}

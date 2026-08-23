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
  'button, [role="button"], [data-product-id], .wn-select-trigger, a[href], .conn-item'

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

function pointerInit(e: PointerEvent): PointerEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX: e.clientX,
    clientY: e.clientY,
    pointerId: e.pointerId,
    pointerType: e.pointerType || 'mouse',
    isPrimary: e.isPrimary ?? true,
    view: window,
  }
}

/**
 * chrome 穿透：原事件目标不是命令本身，必须重派。
 * 合成 pointerdown 在 WKWebView 上不可靠，最终靠 click → pressProps.onClick。
 */
function retargetChromeControl(control: HTMLElement, e: PointerEvent) {
  const init = pointerInit(e)
  queueMicrotask(() => {
    if (!control.isConnected) return
    control.dispatchEvent(new PointerEvent('pointerdown', init))
    control.click()
  })
}

/**
 * 右键菜单项：不 stop 原事件（让 pressProps 有机会直接跑），
 * 再 microtask click 兜底；pressProps 短时去重防双触发。
 */
function ensureContextMenuPress(command: HTMLElement) {
  queueMicrotask(() => {
    if (!command.isConnected) return
    command.click()
  })
}

let installed = false

/**
 * installFocusGate — 捕获阶段保证命令首击必达。
 *
 * 1. 右键菜单：只 blur + click 兜底，禁止 stopImmediate（否则 portal 上 pressProps 永收不到）
 * 2. 内容持焦点到普通按钮：blur 后重派
 * 3. 浮层盖住显式 chrome：dismiss + 转发给下方控件
 */
export function installFocusGate(): () => void {
  if (installed) return () => {}
  installed = true

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (!e.isTrusted) return

    const inContextMenu =
      e.target instanceof Element && !!e.target.closest('.wn-context-menu')

    if (inContextMenu) {
      const command = findCommandControl(e.target)
      if (command) {
        if (shouldReleaseForCommand(command)) blurActive()
        ensureContextMenuPress(command)
      }
      return
    }

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
          retargetChromeControl(control, e)
          return
        }
      }
    }

    const command = findCommandControl(e.target)
    if (command && shouldReleaseForCommand(command)) {
      blurActive()
      // 不 stop：同一次 pointerdown 上的 pressProps 继续执行；click 仅作 WKWebView 兜底
      e.preventDefault()
      ensureContextMenuPress(command)
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    installed = false
  }
}

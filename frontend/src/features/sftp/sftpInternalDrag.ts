/** SFTP 窗格间内部拖放载荷（指针拖拽；自绘抓取光标，避免按下后系统光标锁死为箭头）。 */
export interface DragPayload {
  side: 'local' | 'remote'
  paths: string[]
}

const DROP_EVENT = 'sftp-internal-drop'
const DRAG_THRESHOLD = 5

const GRAB_CURSOR_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <g fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path fill="#fff" d="M11 14V8.5a1.5 1.5 0 0 1 3 0V14"/>
        <path fill="#fff" d="M14 14V7a1.5 1.5 0 0 1 3 0v7"/>
        <path fill="#fff" d="M17 14V8a1.5 1.5 0 0 1 3 0v6"/>
        <path fill="#fff" d="M20 14.5V10a1.5 1.5 0 0 1 3 0v7.5c0 4.2-2.8 7-7.5 7S8 21.7 8 17.5V13a1.8 1.8 0 0 1 3.4-.8"/>
      </g>
    </svg>`
  )

let active: DragPayload | null = null
let cursorEl: HTMLDivElement | null = null
const watchers = new Set<() => void>()

/** getActiveSftpDrag 当前内部拖放载荷。 */
export function getActiveSftpDrag(): DragPayload | null {
  return active
}

/** subscribeSftpDrag 订阅内部拖放状态变化。 */
export function subscribeSftpDrag(fn: () => void): () => void {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}

function notify() {
  watchers.forEach((fn) => fn())
}

function ensureCursorEl() {
  if (cursorEl) return cursorEl
  const el = document.createElement('div')
  el.className = 'sftp-drag-cursor'
  el.setAttribute('aria-hidden', 'true')
  el.style.backgroundImage = `url("${GRAB_CURSOR_SVG}")`
  document.body.appendChild(el)
  cursorEl = el
  return el
}

/** moveSftpDragCursor 移动自绘抓取光标。 */
export function moveSftpDragCursor(clientX: number, clientY: number) {
  const el = ensureCursorEl()
  el.style.transform = `translate(${clientX - 6}px, ${clientY - 2}px)`
}

/** beginSftpDrag 开始内部拖放并显示抓取光标。 */
export function beginSftpDrag(payload: DragPayload, clientX: number, clientY: number) {
  active = payload
  document.body.classList.add('is-sftp-file-dragging')
  moveSftpDragCursor(clientX, clientY)
  notify()
}

/** endSftpDrag 结束内部拖放。 */
export function endSftpDrag() {
  if (!active && !cursorEl) return
  active = null
  document.body.classList.remove('is-sftp-file-dragging')
  if (cursorEl) {
    cursorEl.remove()
    cursorEl = null
  }
  notify()
}

/** dispatchSftpDropAt 在坐标处查找投放目标并派发事件。 */
export function dispatchSftpDropAt(clientX: number, clientY: number, payload: DragPayload): boolean {
  const el = document.elementFromPoint(clientX, clientY)
  const root = el?.closest?.('[data-sftp-drop-root]') as HTMLElement | null
  if (!root) return false
  const accept = (root.dataset.sftpAccept || '').split(',').filter(Boolean)
  if (!accept.includes(payload.side)) return false
  root.dispatchEvent(
    new CustomEvent(DROP_EVENT, {
      detail: payload,
      bubbles: false,
    })
  )
  return true
}

/** SFTP_INTERNAL_DROP_EVENT 投放自定义事件名。 */
export const SFTP_INTERNAL_DROP_EVENT = DROP_EVENT

/** SFTP_DRAG_THRESHOLD 判定为拖拽的最小像素位移。 */
export const SFTP_DRAG_THRESHOLD = DRAG_THRESHOLD

import type { Terminal } from '@xterm/xterm'
import { bindSelectionGuard } from '../../components/compat'

type CellPos = { x: number; y: number }

/** 缓冲区最后一行有可见字符的绝对行号；全空返回 -1。 */
function lastShellContentLineY(term: Terminal): number {
  const buf = term.buffer.active
  for (let y = buf.length - 1; y >= 0; y--) {
    const line = buf.getLine(y)
    if (!line) continue
    if (line.translateToString(true).trim().length > 0) return y
  }
  return -1
}

function lineContentEndX(term: Terminal, y: number): number {
  const line = term.buffer.active.getLine(y)
  if (!line) return 0
  for (let x = line.length - 1; x >= 0; x--) {
    const cell = line.getCell(x)
    if (!cell) continue
    const ch = cell.getChars()
    if (ch && ch.trim() !== '') return x + Math.max(1, cell.getWidth())
  }
  return 0
}

function orderedRange(a: CellPos, b: CellPos): { start: CellPos; end: CellPos } {
  if (a.y < b.y || (a.y === b.y && a.x <= b.x)) return { start: a, end: b }
  return { start: b, end: a }
}

/** end.x 为 exclusive。 */
function toSelectLength(start: CellPos, end: CellPos, cols: number): number {
  if (end.y < start.y || (end.y === start.y && end.x <= start.x)) return 0
  if (start.y === end.y) return end.x - start.x
  let n = cols - start.x
  for (let y = start.y + 1; y < end.y; y++) n += cols
  n += end.x
  return n
}

function clientToBufferCell(
  term: Terminal,
  screen: HTMLElement,
  event: { clientX: number; clientY: number },
): CellPos | null {
  if (term.cols <= 0 || term.rows <= 0) return null
  const rect = screen.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const cellW = rect.width / term.cols
  const cellH = rect.height / term.rows
  let col = Math.ceil((event.clientX - rect.left + cellW / 2) / cellW) - 1
  let row = Math.ceil((event.clientY - rect.top) / cellH) - 1
  col = Math.min(Math.max(col, 0), term.cols)
  row = Math.min(Math.max(row, 0), term.rows - 1)
  return { x: col, y: term.buffer.active.viewportY + row }
}

function isSelectableContentRow(term: Terminal, y: number): boolean {
  const last = lastShellContentLineY(term)
  return last >= 0 && y <= last
}

/** 选区夹回到有 shell 输出的行（含末行内容右界）。 */
function clampSelectionToShellContent(term: Terminal): void {
  if (!term.hasSelection()) return
  const pos = term.getSelectionPosition()
  if (!pos) return

  const last = lastShellContentLineY(term)
  if (last < 0) {
    term.clearSelection()
    return
  }

  const { start, end } = orderedRange(pos.start, pos.end)
  if (start.y > last) {
    term.clearSelection()
    return
  }

  const contentEndX = lineContentEndX(term, last)
  let endY = end.y
  let endX = end.x
  if (endY > last) {
    endY = last
    endX = Math.max(contentEndX, start.y === last ? start.x + 1 : 1)
  } else if (endY === last && endX > contentEndX) {
    endX = Math.max(contentEndX, start.y === last ? start.x + 1 : 0)
  }
  if (endY === end.y && endX === end.x) return

  const length = toSelectLength(start, { x: endX, y: endY }, term.cols)
  if (length <= 0) {
    term.clearSelection()
    return
  }
  term.select(start.x, start.y, length)
}

/**
 * bindTerminalShellSelection 终端选区策略（单一入口）：
 * 1. 点按无拖 → 清选（compat selectionGuard）
 * 2. 空白视口捕获拦截起选/拖拽（否则 xterm 每帧重画，事后 clear 无效）
 * 3. onSelectionChange 越界夹回（键盘 Shift 选等）
 */
export function bindTerminalShellSelection(term: Terminal, host: HTMLElement): () => void {
  let screenEl: HTMLElement | null = null
  const screen = (): HTMLElement | null => {
    if (screenEl?.isConnected) return screenEl
    screenEl = host.querySelector('.xterm-screen')
    return screenEl
  }

  let suppressEmpty = false
  let clamping = false
  const clamp = () => {
    if (clamping) return
    clamping = true
    try {
      clampSelectionToShellContent(term)
    } finally {
      clamping = false
    }
  }

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    const sc = screen()
    const cell = sc ? clientToBufferCell(term, sc, e) : null
    if (!cell || !isSelectableContentRow(term, cell.y)) {
      suppressEmpty = true
      e.preventDefault()
      e.stopImmediatePropagation()
      term.clearSelection()
      return
    }
    suppressEmpty = false
  }

  const onMove = (e: MouseEvent) => {
    if ((e.buttons & 1) === 0) {
      suppressEmpty = false
      return
    }
    if (suppressEmpty) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (term.hasSelection()) term.clearSelection()
      return
    }
    const sc = screen()
    const cell = sc ? clientToBufferCell(term, sc, e) : null
    if (cell && !isSelectableContentRow(term, cell.y)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      clamp()
    }
  }

  const onUp = () => {
    suppressEmpty = false
    clamp()
  }

  const unbindClickClear = bindSelectionGuard(host, () => term.clearSelection())
  host.addEventListener('mousedown', onDown, true)
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('mouseup', onUp, true)
  const selSub = term.onSelectionChange(clamp)

  return () => {
    unbindClickClear()
    host.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('mouseup', onUp, true)
    selSub.dispose()
  }
}

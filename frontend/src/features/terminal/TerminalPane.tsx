import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../../api/client'
import { onTerminalClosed, onTerminalOutput } from '../../api/terminalEvents'
import { bindSelectionGuard, zoomCompensatedPx } from '../../components/compat'
import { useAppStore } from '../../stores/appStore'
import { registerTerminalFocus } from './terminalFocus'

interface Props {
  sessionId: string
  active: boolean
  opacity: number
}

/** 终端背景：不透明度越低越能透出桌面（仅终端区）。 */
export function terminalBackground(opacity: number): string {
  const a = Math.min(1, Math.max(0.15, opacity))
  return `rgba(0, 0, 0, ${a.toFixed(3)})`
}

const XTERM_CLEAR_BG = '#00000000'
const BASE_TERM_FONT_PX = 12

/** 在容器可见且有尺寸时调整 xterm，避免 hidden/销毁后报错。 */
function safeFit(fit: FitAddon, term: Terminal, el: HTMLElement): boolean {
  if (el.clientWidth <= 0 || el.clientHeight <= 0) return false
  try {
    fit.fit()
    return term.cols > 0 && term.rows > 0
  } catch {
    return false
  }
}

/** termFontSizeForUi 按壳层字号档位缩放终端字号（配合 host 反 zoom）。 */
function termFontSizeForUi(uiFontSize: number): number {
  return Math.max(11, zoomCompensatedPx(BASE_TERM_FONT_PX, uiFontSize))
}

/** xterm 终端视图 */
export function TerminalPane({ sessionId, active, opacity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const uiFontSize = useAppStore((s) => s.uiFontSize)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let disposed = false
    const fontSize = termFontSizeForUi(useAppStore.getState().uiFontSize)

    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
      allowTransparency: true,
      theme: {
        // 画布透明，由宿主 div 承担半透明底，避免双层 alpha 叠死
        background: XTERM_CLEAR_BG,
        foreground: '#d4d4dc',
        cursor: '#d4d4dc',
        selectionBackground: '#3f3f46',
        selectionInactiveBackground: '#2a2a30',
      },
      convertEol: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    const resize = () => {
      if (disposed) return
      if (!safeFit(fit, term, el)) return
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
    }

    requestAnimationFrame(resize)

    const unregisterFocus = registerTerminalFocus(sessionId, () => {
      if (!disposed) term.focus()
    })

    const disposeData = term.onData((data) => {
      api.writeTerminal(sessionId, data).catch(() => {
        if (!disposed) term.writeln('\r\n\x1b[31m[连接已断开]\x1b[0m')
      })
    })

    const offOutput = onTerminalOutput((evt) => {
      if (evt.sessionId !== sessionId || disposed) return
      if (evt.data) term.write(evt.data)
    })

    const offClosed = onTerminalClosed((sid) => {
      if (sid !== sessionId || disposed) return
      term.writeln('\r\n\x1b[33m[会话已结束]\x1b[0m')
    })

    const unbindGuard = bindSelectionGuard(el, () => term.clearSelection())
    const ro = new ResizeObserver(() => resize())
    ro.observe(el)

    return () => {
      disposed = true
      unbindGuard()
      unregisterFocus()
      disposeData.dispose()
      offOutput()
      offClosed()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    const el = containerRef.current
    const term = termRef.current
    const fit = fitRef.current
    if (!el || !term || !fit) return
    const next = termFontSizeForUi(uiFontSize)
    if (term.options.fontSize === next) return
    term.options.fontSize = next
    requestAnimationFrame(() => {
      if (!safeFit(fit, term, el)) return
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
    })
  }, [uiFontSize, sessionId])

  useEffect(() => {
    const el = containerRef.current
    const term = termRef.current
    if (!el || !term) return
    const bg = terminalBackground(opacity)
    el.style.backgroundColor = bg
    // 保持画布透明，只改宿主底色
    if (term.options.theme?.background !== XTERM_CLEAR_BG) {
      term.options.theme = {
        ...term.options.theme,
        background: XTERM_CLEAR_BG,
      }
      term.refresh(0, term.rows - 1)
    }
  }, [opacity])

  useEffect(() => {
    const term = termRef.current
    if (!active) {
      term?.clearSelection()
      return
    }
    const el = containerRef.current
    const fit = fitRef.current
    if (!el || !fit || !term) return
    requestAnimationFrame(() => {
      if (!safeFit(fit, term, el)) return
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
      term.focus()
    })
  }, [active, sessionId])

  return (
    <div
      ref={containerRef}
      className="terminal-xterm-host ww-zoom-content"
      data-ww-focus-hog=""
      style={{ backgroundColor: terminalBackground(opacity) }}
    />
  )
}

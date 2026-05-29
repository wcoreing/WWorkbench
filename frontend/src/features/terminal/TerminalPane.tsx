import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../../api/client'
import { onTerminalClosed, onTerminalOutput } from '../../api/terminalEvents'

interface Props {
  sessionId: string
  active: boolean
  opacity: number
}

/** 根据透明度生成终端背景色。 */
export function terminalBackground(opacity: number): string {
  const a = Math.min(1, Math.max(0.4, opacity))
  return `rgba(12, 12, 14, ${a.toFixed(3)})`
}

/** xterm 终端视图 */
export function TerminalPane({ sessionId, active, opacity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
      allowTransparency: true,
      theme: {
        background: terminalBackground(opacity),
        foreground: '#d4d4dc',
        cursor: '#d4d4dc',
      },
      convertEol: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const disposeData = term.onData((data) => {
      api.writeTerminal(sessionId, data).catch(() => {
        term.writeln('\r\n\x1b[31m[连接已断开]\x1b[0m')
      })
    })

    const offOutput = onTerminalOutput((evt) => {
      if (evt.sessionId !== sessionId) return
      if (evt.data) term.write(evt.data)
    })

    const offClosed = onTerminalClosed((sid) => {
      if (sid !== sessionId) return
      term.writeln('\r\n\x1b[33m[会话已结束]\x1b[0m')
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
    })
    ro.observe(el)

    return () => {
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
    if (!el || !term) return
    const bg = terminalBackground(opacity)
    el.style.backgroundColor = bg
    term.options.theme = {
      ...term.options.theme,
      background: bg,
    }
    term.refresh(0, term.rows - 1)
  }, [opacity])

  useEffect(() => {
    if (!active) return
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return
    requestAnimationFrame(() => {
      fit.fit()
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
    })
  }, [active, sessionId])

  return (
    <div
      ref={containerRef}
      className="terminal-xterm-host"
      style={{ backgroundColor: terminalBackground(opacity) }}
    />
  )
}

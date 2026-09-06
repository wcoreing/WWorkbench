import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../../api/client'
import { onTerminalClosed, onTerminalOutput } from '../../api/terminalEvents'
import { bindSelectionGuard, pressProps, zoomCompensatedPx } from '../../components/compat'
import { ContextMenu } from '../../components/ContextMenu'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { registerTerminalFocus } from './terminalFocus'
import {
  AGENT_SHELL_TAIL_LINES,
  pasteIntoTerminal,
  readXtermCopyText,
  readXtermTail,
  registerTerminalClipboard,
  registerTerminalTail,
  setActiveTerminalTailSession,
  writeAppClipboard,
} from './terminalClipboard'

interface Props {
  sessionId: string
  active: boolean
  /** 当前分屏焦点窗格（写入 Agent 上下文的那一路 Shell）。 */
  focused?: boolean
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

/** xterm 终端视图：sessionId 变更时热绑定，保留 scrollback。 */
export function TerminalPane({ sessionId, active, focused = false, opacity }: Props) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const boundSessionRef = useRef<string | null>(null)
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // 生命周期内只建一次 xterm，避免重连清空历史
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
      rightClickSelectsWord: true,
      theme: {
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

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const key = ev.key.toLowerCase()
      const copyKey = (ev.metaKey && key === 'c') || (ev.ctrlKey && ev.shiftKey && key === 'c')
      const copySelOnly = ev.ctrlKey && !ev.metaKey && !ev.shiftKey && key === 'c' && term.hasSelection()
      if (copyKey || copySelOnly) {
        void (async () => {
          const text = readXtermCopyText(term)
          if (!text) {
            useAppStore.getState().setStatusMessage(tRef.current('terminal.copyEmpty'))
            return
          }
          const ok = await writeAppClipboard(text)
          useAppStore.getState().setStatusMessage(ok ? tRef.current('terminal.copied') : tRef.current('terminal.copyFailed'))
        })()
        return false
      }
      return true
    })

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const sync = e.clipboardData?.getData('text/plain')
      void pasteIntoTerminal(sessionIdRef.current, sync || undefined).catch((err) => {
        useAppStore.getState().setStatusMessage((err as Error).message)
      })
    }
    el.addEventListener('paste', onPaste, true)

    const resize = () => {
      if (disposed) return
      if (!safeFit(fit, term, el)) return
      api.resizeTerminal(sessionIdRef.current, term.cols, term.rows).catch(() => {})
    }

    requestAnimationFrame(resize)

    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      setCtxMenu({ x: e.clientX, y: e.clientY })
    }
    el.addEventListener('contextmenu', onCtx)

    const unbindGuard = bindSelectionGuard(el, () => term.clearSelection())
    const ro = new ResizeObserver(() => resize())
    ro.observe(el)

    return () => {
      disposed = true
      el.removeEventListener('contextmenu', onCtx)
      el.removeEventListener('paste', onPaste, true)
      unbindGuard()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      boundSessionRef.current = null
    }
  }, [])

  // 会话热绑定：换 sessionId 时不销毁 xterm，续写历史
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    const el = containerRef.current
    if (!term || !fit || !el) return

    let disposed = false
    const prev = boundSessionRef.current
    if (prev && prev !== sessionId) {
      term.writeln(`\r\n\x1b[32m[${tRef.current('terminal.sessionReconnected')}]\x1b[0m`)
    }
    boundSessionRef.current = sessionId

    const copyOut = async () => {
      const text = readXtermCopyText(term)
      if (!text) {
        useAppStore.getState().setStatusMessage(tRef.current('terminal.copyEmpty'))
        return ''
      }
      const ok = await writeAppClipboard(text)
      useAppStore.getState().setStatusMessage(ok ? tRef.current('terminal.copied') : tRef.current('terminal.copyFailed'))
      return ok ? text : ''
    }
    const pasteIn = async (text?: string) => {
      try {
        const ok = await pasteIntoTerminal(sessionId, text)
        if (!ok) useAppStore.getState().setStatusMessage(tRef.current('terminal.copyEmpty'))
        return ok
      } catch (e) {
        useAppStore.getState().setStatusMessage((e as Error).message)
        return false
      }
    }

    const unregisterClip = registerTerminalClipboard(sessionId, {
      copy: copyOut,
      paste: pasteIn,
    })
    const unregisterTail = registerTerminalTail(sessionId, () => readXtermTail(term, AGENT_SHELL_TAIL_LINES))
    const unregisterFocus = registerTerminalFocus(sessionId, () => {
      if (!disposed) term.focus()
    })

    const disposeData = term.onData((data) => {
      api.writeTerminal(sessionId, data).catch(() => {
        if (!disposed) term.writeln(`\r\n\x1b[31m[${tRef.current('terminal.connectionLost')}]\x1b[0m`)
      })
    })

    const offOutput = onTerminalOutput((evt) => {
      if (evt.sessionId !== sessionId || disposed) return
      if (evt.data) term.write(evt.data)
    })

    const offClosed = onTerminalClosed((sid) => {
      if (sid !== sessionId || disposed) return
      term.writeln(`\r\n\x1b[33m[${tRef.current('terminal.sessionEnded')}]\x1b[0m`)
    })

    requestAnimationFrame(() => {
      if (disposed) return
      if (!safeFit(fit, term, el)) return
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {})
    })

    return () => {
      disposed = true
      unregisterClip()
      unregisterTail()
      unregisterFocus()
      disposeData.dispose()
      offOutput()
      offClosed()
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
      api.resizeTerminal(sessionIdRef.current, term.cols, term.rows).catch(() => {})
    })
  }, [uiFontSize])

  useEffect(() => {
    const el = containerRef.current
    const term = termRef.current
    if (!el || !term) return
    const bg = terminalBackground(opacity)
    el.style.backgroundColor = bg
    if (term.options.theme?.background !== XTERM_CLEAR_BG) {
      term.options.theme = {
        ...term.options.theme,
        background: XTERM_CLEAR_BG,
      }
      term.refresh(0, term.rows - 1)
    }
  }, [opacity])

  useEffect(() => {
    if (focused) setActiveTerminalTailSession(sessionId)
  }, [focused, sessionId])

  useEffect(() => {
    const term = termRef.current
    if (!active) {
      term?.clearSelection()
      setCtxMenu(null)
      return
    }
    const el = containerRef.current
    const fit = fitRef.current
    if (!el || !fit || !term) return
    requestAnimationFrame(() => {
      if (!safeFit(fit, term, el)) return
      api.resizeTerminal(sessionIdRef.current, term.cols, term.rows).catch(() => {})
      term.focus()
    })
  }, [active, sessionId])

  const runCopy = () => {
    void (async () => {
      const text = termRef.current ? readXtermCopyText(termRef.current) : ''
      if (!text) {
        setStatusMessage(t('terminal.copyEmpty'))
        return
      }
      const ok = await writeAppClipboard(text)
      setStatusMessage(ok ? t('terminal.copied') : t('terminal.copyFailed'))
    })()
    setCtxMenu(null)
  }

  const runPaste = () => {
    void pasteIntoTerminal(sessionId).catch((e) => setStatusMessage((e as Error).message))
    setCtxMenu(null)
  }

  return (
    <>
      <div
        ref={containerRef}
        className="terminal-xterm-host ww-zoom-content"
        data-ww-focus-hog=""
        style={{ backgroundColor: terminalBackground(opacity) }}
      />
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onDismiss={() => setCtxMenu(null)}>
          <button type="button" className="wn-context-item" {...pressProps(runCopy)}>
            {t('terminal.copy')}
          </button>
          <button type="button" className="wn-context-item" {...pressProps(runPaste)}>
            {t('terminal.paste')}
          </button>
        </ContextMenu>
      )}
    </>
  )
}

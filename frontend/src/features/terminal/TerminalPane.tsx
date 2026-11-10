import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../../api/client'
import { onTerminalClosed, onTerminalOutput } from '../../api/terminalEvents'
import { bindSelectionGuard, pressProps, zoomCompensatedPx } from '../../components/compat'
import { ContextMenu } from '../../components/ContextMenu'
import { IconRefresh } from '../../components/Icons'
import { openAgentDraft } from '../agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { useAgentStore } from '../../stores/agentStore'
import { openBackup } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { openCapability } from '../../workbench/workbenchCommandBus'
import { joinRemotePath } from '../sftp/sftpUtils'
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
import {
  formatFrequentPathLabel,
  frequentPathsHostKey,
  loadFrequentPaths,
  shellSingleQuote,
  topFrequentPaths,
  touchFrequentPath,
  type FrequentPathEntry,
} from './frequentPaths'

interface Props {
  sessionId: string
  /** SSH / Docker ShellHost id；本机终端为空。 */
  hostId?: string
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

/** normalizeTerminalPathToken 取选区首行首段路径 token；拒绝 shell 提示符等噪音。 */
function normalizeTerminalPathToken(raw: string): string {
  const line = raw.trim().split(/\r?\n/)[0]?.trim() || ''
  const token = line.split(/\s+/)[0]?.replace(/^['"]+|['"]+$/g, '') || ''
  if (!token) return ''
  // user@host:~# / root@ip:~$ 等提示符
  if (/@/.test(token) && /[:#]/.test(token)) return ''
  if (/[~#$]$/.test(token)) return ''
  if (token.includes(']') && token.includes('[')) return ''
  // 仅允许路径安全字符（相对名 data、绝对 /www/...）
  if (!/^[\w./+-]+$/.test(token)) return ''
  return token
}

/** xterm 终端视图：sessionId 变更时热绑定，保留 scrollback。 */
export function TerminalPane({ sessionId, hostId = '', active, focused = false, opacity }: Props) {
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
  const [sessionEnded, setSessionEnded] = useState(false)
  const [frequentPaths, setFrequentPaths] = useState<FrequentPathEntry[]>([])
  const hostKeyRef = useRef(frequentPathsHostKey(hostId))
  hostKeyRef.current = frequentPathsHostKey(hostId)

  // 生命周期内只建一次 xterm，避免重连清空历史
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let disposed = false
    setSessionEnded(false)
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
      setSessionEnded(true)
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

  /** 右键打开时：探测 cwd 累计使用，并刷新常用路径菜单。 */
  useEffect(() => {
    if (!ctxMenu) return
    let cancelled = false
    void (async () => {
      try {
        let hostKey = hostKeyRef.current
        let cwdPath = ''
        try {
          const probed = await api.probeTerminalCwd(sessionIdRef.current)
          if (probed.hostKey) hostKey = frequentPathsHostKey(probed.hostKey)
          cwdPath = (probed.path || '').trim()
        } catch {
          /* 探测失败仍展示已有常用路径 */
        }
        hostKeyRef.current = hostKey
        let list: FrequentPathEntry[]
        if (cwdPath.startsWith('/')) {
          list = await touchFrequentPath(hostKey, cwdPath)
        } else {
          list = await loadFrequentPaths(hostKey)
        }
        if (!cancelled) setFrequentPaths(topFrequentPaths(list))
      } catch {
        if (!cancelled) setFrequentPaths([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ctxMenu, sessionId])

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

  const reconnectSession = () => {
    openCapability(Capability.TerminalReconnect, { sessionId }, 'terminal')
  }

  const askAboutEnded = () => {
    useAgentStore.getState().setChatMode('plan')
    openAgentDraft({
      mentions: [],
      message: t('agent.draftSessionEnded'),
    })
  }

  const grantMcpWriteDir = () => {
    setCtxMenu(null)
    if (sessionEnded) {
      setStatusMessage(t('terminal.mcpWriteNeedReconnect'))
      return
    }
    void (async () => {
      try {
        setStatusMessage(t('terminal.mcpWriteGranting'))
        const allow = await api.grantMCPWriteDir(sessionIdRef.current)
        setStatusMessage(t('terminal.mcpWriteGranted', { path: allow.path }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }

  const revokeMcpWriteDir = () => {
    setCtxMenu(null)
    void (async () => {
      try {
        await api.revokeMCPWriteDir(sessionIdRef.current, '')
        setStatusMessage(t('terminal.mcpWriteRevoked'))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }

  /** jumpToFrequentPath 注入 cd 进入常用路径，并再记一次使用。 */
  const jumpToFrequentPath = (path: string) => {
    setCtxMenu(null)
    if (sessionEnded) {
      setStatusMessage(t('terminal.mcpWriteNeedReconnect'))
      return
    }
    void (async () => {
      try {
        await pasteIntoTerminal(sessionIdRef.current, `cd ${shellSingleQuote(path)}\n`)
        const list = await touchFrequentPath(hostKeyRef.current, path)
        setFrequentPaths(topFrequentPaths(list))
        setStatusMessage(t('terminal.frequentPathJumped', { path }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }

  /** createBackupFromTerminal 用选区路径（或当前目录）起草备份策略。 */
  const createBackupFromTerminal = () => {
    setCtxMenu(null)
    void (async () => {
      try {
        const sel = termRef.current ? normalizeTerminalPathToken(readXtermCopyText(termRef.current)) : ''
        let cwd = ''
        try {
          const probed = await api.probeTerminalCwd(sessionIdRef.current)
          cwd = (probed.path || '').trim()
        } catch {
          /* 选区已是绝对路径时可不依赖 cwd */
        }
        let path = ''
        if (sel.startsWith('/')) {
          path = sel
        } else if (sel && cwd.startsWith('/')) {
          path = joinRemotePath(cwd, sel)
        } else if (cwd.startsWith('/')) {
          // 选区非法（提示符等）时回退当前目录
          path = cwd
        }
        if (!path.startsWith('/')) {
          setStatusMessage(t('terminal.backupNeedPath'))
          return
        }
        const base = path.split('/').filter(Boolean).pop() || path
        const kind = base.toLowerCase().endsWith('.db') ? 'sqlite' : 'files'
        openBackup(
          {
            create: true,
            name: base,
            kind,
            path,
            sshHostId: hostId || undefined,
          },
          'terminal',
        )
        setStatusMessage(t('terminal.backupDrafted', { path }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }

  return (
    <div className="terminal-pane-stack">
      <div
        ref={containerRef}
        className="terminal-xterm-host ww-zoom-content"
        data-ww-focus-hog=""
        style={{ backgroundColor: terminalBackground(opacity) }}
      />
      {sessionEnded && (
        <div className="terminal-ended-bar" role="status">
          <span className="terminal-ended-bar-text">{t('terminal.sessionEndedHint')}</span>
          <div className="terminal-ended-bar-actions">
            <button type="button" className="wn-btn wn-btn-chrome wn-btn-sm" {...pressProps(reconnectSession)}>
              <IconRefresh size={13} />
              <span>{t('terminal.reconnect')}</span>
            </button>
            <button type="button" className="wn-btn wn-btn-ghost wn-btn-sm" {...pressProps(askAboutEnded)}>
              <span>{t('terminal.askAfterEnded')}</span>
            </button>
          </div>
        </div>
      )}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onDismiss={() => setCtxMenu(null)}>
          <button type="button" className="wn-context-item" {...pressProps(runCopy)}>
            {t('terminal.copy')}
          </button>
          <button type="button" className="wn-context-item" {...pressProps(runPaste)}>
            {t('terminal.paste')}
          </button>
          <div className="wn-context-sep" />
          <div className="wn-context-submenu-label">{t('terminal.frequentPaths')}</div>
          {frequentPaths.length === 0 ? (
            <div className="wn-context-item wn-context-item-indent is-muted">
              {t('terminal.frequentPathsEmpty')}
            </div>
          ) : (
            frequentPaths.map((item) => (
              <button
                key={item.path}
                type="button"
                className="wn-context-item wn-context-item-indent"
                title={`${item.path} · ×${item.count}`}
                {...pressProps(() => jumpToFrequentPath(item.path))}
              >
                {formatFrequentPathLabel(item.path)}
              </button>
            ))
          )}
          <div className="wn-context-sep" />
          <button type="button" className="wn-context-item" {...pressProps(createBackupFromTerminal)}>
            {t('terminal.createBackupPolicy')}
          </button>
          <div className="wn-context-sep" />
          <button type="button" className="wn-context-item" {...pressProps(grantMcpWriteDir)}>
            {t('terminal.mcpWriteAllow')}
          </button>
          <button type="button" className="wn-context-item" {...pressProps(revokeMcpWriteDir)}>
            {t('terminal.mcpWriteRevoke')}
          </button>
          {sessionEnded && (
            <>
              <div className="wn-context-sep" />
              <button type="button" className="wn-context-item" {...pressProps(reconnectSession)}>
                {t('terminal.reconnect')}
              </button>
              <button type="button" className="wn-context-item" {...pressProps(askAboutEnded)}>
                {t('terminal.askAfterEnded')}
              </button>
            </>
          )}
        </ContextMenu>
      )}
    </div>
  )
}

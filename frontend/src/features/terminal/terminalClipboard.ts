import type { Terminal } from '@xterm/xterm'
import { ClipboardGetText, ClipboardSetText } from '../../../wailsjs/runtime/runtime'
import { api } from '../../api/client'

/** TERM_TAIL_LINES 无选区时复制的最近输出行数（给 Agent 回贴用）。 */
export const TERM_TAIL_LINES = 20

/** AGENT_SHELL_TAIL_LINES 写入 Agent 回合上下文的 Shell 最近行数。 */
export const AGENT_SHELL_TAIL_LINES = 100

type TailReader = () => string

const tailReaders = new Map<string, TailReader>()
let activeTailSessionId = ''

type TermClipApi = {
  copy: () => Promise<string>
  paste: () => Promise<boolean>
}

const apis = new Map<string, TermClipApi>()

/** writeAppClipboard 写入系统剪贴板（Wails 优先）。 */
export async function writeAppClipboard(text: string): Promise<boolean> {
  const v = text.replace(/\s+$/, '')
  if (!v) return false
  try {
    const ok = await ClipboardSetText(v)
    if (ok) return true
  } catch {
    /* 回退浏览器剪贴板 */
  }
  try {
    await navigator.clipboard.writeText(v)
    return true
  } catch {
    return false
  }
}

/** readAppClipboard 读取系统剪贴板。 */
export async function readAppClipboard(): Promise<string> {
  try {
    const t = await ClipboardGetText()
    if (t) return t
  } catch {
    /* 回退 */
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

/** readXtermTail 读取 xterm 缓冲区末尾若干行。 */
export function readXtermTail(term: Terminal, maxLines = TERM_TAIL_LINES): string {
  const buf = term.buffer.active
  const end = buf.baseY + buf.cursorY
  const start = Math.max(0, end - maxLines + 1)
  const lines: string[] = []
  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i)
    if (!line) continue
    lines.push(line.translateToString(true))
  }
  return lines.join('\n').replace(/\s+$/, '')
}

/** registerTerminalTail 注册会话的缓冲区读取（供 Agent 回合采集）。 */
export function registerTerminalTail(sessionId: string, read: TailReader): () => void {
  tailReaders.set(sessionId, read)
  return () => {
    if (tailReaders.get(sessionId) === read) tailReaders.delete(sessionId)
    if (activeTailSessionId === sessionId) activeTailSessionId = ''
  }
}

/** setActiveTerminalTailSession 标记当前焦点 Shell（产品切换后仍保留）。 */
export function setActiveTerminalTailSession(sessionId: string) {
  if (sessionId) activeTailSessionId = sessionId
}

/** clipShellTail 截到最近 maxLines 行。 */
function clipShellTail(text: string, maxLines: number): string {
  const lines = text.replace(/\s+$/, '').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  if (lines.length <= maxLines) return lines.join('\n')
  return lines.slice(-maxLines).join('\n')
}

/** readAgentShellTail 读取当前焦点 Shell 最近若干行（与终端面板一致）。 */
export function readAgentShellTail(maxLines = AGENT_SHELL_TAIL_LINES): { sessionId: string; text: string } {
  const tryRead = (id: string): string => {
    const fn = tailReaders.get(id)
    return fn ? clipShellTail(fn(), maxLines) : ''
  }
  if (activeTailSessionId) {
    const text = tryRead(activeTailSessionId)
    if (text) return { sessionId: activeTailSessionId, text }
  }
  for (const id of tailReaders.keys()) {
    const text = tryRead(id)
    if (text) return { sessionId: id, text }
  }
  return { sessionId: activeTailSessionId, text: '' }
}

/** readXtermCopyText 有选区复制选区，否则复制最近输出。 */
export function readXtermCopyText(term: Terminal): string {
  const sel = term.getSelection()
  if (sel && sel.trim()) return sel.replace(/\s+$/, '')
  return readXtermTail(term)
}

/** registerTerminalClipboard 注册会话剪贴板操作。 */
export function registerTerminalClipboard(sessionId: string, clip: TermClipApi): () => void {
  apis.set(sessionId, clip)
  return () => {
    if (apis.get(sessionId) === clip) apis.delete(sessionId)
  }
}

/** terminalClipboard 取会话剪贴板 API。 */
export function terminalClipboard(sessionId: string): TermClipApi | undefined {
  return apis.get(sessionId)
}

/** pasteIntoTerminal 把剪贴板写入 PTY。 */
export async function pasteIntoTerminal(sessionId: string): Promise<boolean> {
  const text = await readAppClipboard()
  if (!text) return false
  await api.writeTerminal(sessionId, text)
  return true
}

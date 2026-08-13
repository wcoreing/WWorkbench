const focusHandlers = new Map<string, () => void>()

/** registerTerminalFocus 注册会话聚焦回调。 */
export function registerTerminalFocus(sessionId: string, focus: () => void): () => void {
  focusHandlers.set(sessionId, focus)
  return () => {
    if (focusHandlers.get(sessionId) === focus) focusHandlers.delete(sessionId)
  }
}

/** focusTerminalSession 聚焦指定终端会话。 */
export function focusTerminalSession(sessionId: string) {
  focusHandlers.get(sessionId)?.()
}

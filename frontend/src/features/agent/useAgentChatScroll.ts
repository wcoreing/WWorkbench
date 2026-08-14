import { useCallback, useLayoutEffect, useRef } from 'react'

/** 距底部小于此值才跟滚；用户上翻则暂停，直到再次贴底。 */
const STICK_PX = 96

/** useAgentChatScroll 对话列表贴底跟滚（对齐 AgentDesk：瞬间 scrollTop，无 smooth）。 */
export function useAgentChatScroll(enabled: boolean, contentKey: string) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
  }, [])

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current
    if (!el) return
    if (!force && !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  const pinToBottom = useCallback(() => {
    stickToBottomRef.current = true
    scrollToBottom(true)
  }, [scrollToBottom])

  useLayoutEffect(() => {
    if (!enabled) return
    scrollToBottom()
  }, [enabled, contentKey, scrollToBottom])

  return { scrollRef, onScroll, scrollToBottom, pinToBottom }
}

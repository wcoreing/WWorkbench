import { useEffect, useRef } from 'react'

/**
 * useScrollActiveTabIntoView 激活标签变化时，将 `.wn-tab.active` 滚入 `.wn-tabs` 可视区。
 * 已在可视区内时不滚动（inline: nearest）。
 */
export function useScrollActiveTabIntoView(activeId: string | null | undefined) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const booted = useRef(false)

  useEffect(() => {
    const root = tabsRef.current
    if (!root || !activeId) return
    const el = root.querySelector<HTMLElement>('.wn-tab.active')
    if (!el) return
    const smooth = booted.current
    booted.current = true
    // rAF：等 DOM 把 active class / 新 tab 画完再滚
    const id = requestAnimationFrame(() => {
      el.scrollIntoView({
        behavior: smooth ? 'smooth' : 'instant',
        inline: 'nearest',
        block: 'nearest',
      })
    })
    return () => cancelAnimationFrame(id)
  }, [activeId])

  return tabsRef
}

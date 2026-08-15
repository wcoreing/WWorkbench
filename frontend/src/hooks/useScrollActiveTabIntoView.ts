import { useEffect, useRef } from 'react'

/**
 * scrollTabIntoView 仅调整标签条 scrollLeft，避免 scrollIntoView 带动祖先滚动
 * （Wails/WebKit 下会导致标签叠字、工具条与 chrome 错位）。
 */
function scrollTabIntoView(root: HTMLElement, el: HTMLElement) {
  const rootRect = root.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const pad = 12
  if (elRect.left < rootRect.left + pad) {
    root.scrollLeft -= rootRect.left + pad - elRect.left
    return
  }
  if (elRect.right > rootRect.right - pad) {
    root.scrollLeft += elRect.right - (rootRect.right - pad)
  }
}

/**
 * useScrollActiveTabIntoView 激活标签变化时，将 `.wn-tab.active` 滚入 `.wn-tabs` 可视区。
 * 已在可视区内时不滚动。
 */
export function useScrollActiveTabIntoView(activeId: string | null | undefined) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const booted = useRef(false)

  useEffect(() => {
    const root = tabsRef.current
    if (!root || !activeId) return
    const el = root.querySelector<HTMLElement>('.wn-tab.active')
    if (!el) return
    booted.current = true
    const id = requestAnimationFrame(() => {
      scrollTabIntoView(root, el)
    })
    return () => cancelAnimationFrame(id)
  }, [activeId])

  return tabsRef
}

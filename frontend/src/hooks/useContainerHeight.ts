import { useEffect, useState, type RefObject } from 'react'

/** useContainerHeight 用 ResizeObserver 测量容器像素高度，供 Monaco 等需要明确高度的组件使用。 */
export function useContainerHeight(ref: RefObject<HTMLElement | null>, min = 120): number {
  const [height, setHeight] = useState(min)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const h = el.clientHeight
      if (h > 0) setHeight(Math.max(min, h))
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, min])

  return height
}

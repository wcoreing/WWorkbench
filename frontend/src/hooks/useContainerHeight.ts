import { useEffect, useRef, useState, type RefObject } from 'react'

/** useContainerHeight 用 ResizeObserver 测量容器像素高度，供 Monaco 等需要明确高度的组件使用。 */
export function useContainerHeight(ref: RefObject<HTMLElement | null>, min = 120): number {
  const [height, setHeight] = useState(min)
  const heightRef = useRef(min)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const h = el.clientHeight
      if (h <= 0) return
      const next = Math.max(min, h)
      if (next === heightRef.current) return
      heightRef.current = next
      setHeight(next)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, min])

  return height
}

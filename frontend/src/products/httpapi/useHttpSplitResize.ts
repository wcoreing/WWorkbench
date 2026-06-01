import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'httpapi_response_ratio'
const DEFAULT_RATIO = 0.42

/** loadRatio 读取响应区分屏比例。 */
function loadRatio(): number {
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_KEY) ?? '')
    if (v >= 0.22 && v <= 0.72) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_RATIO
}

/** useHttpSplitResize Apifox 式上下分屏拖拽。 */
export function useHttpSplitResize() {
  const [ratio, setRatio] = useState(loadRatio)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startRatio = useRef(0)
  const hostRef = useRef<HTMLDivElement | null>(null)

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startY.current = e.clientY
      startRatio.current = ratio
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [ratio],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !hostRef.current) return
      const h = hostRef.current.getBoundingClientRect().height
      if (h < 120) return
      const delta = e.clientY - startY.current
      const next = Math.min(0.72, Math.max(0.22, startRatio.current - delta / h))
      setRatio(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setRatio((r) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(r))
        } catch {
          /* ignore */
        }
        return r
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return { hostRef, ratio, onResizeStart }
}

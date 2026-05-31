import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'agent_panel_width'
const MIN_W = 280
const MAX_W = 720
const DEFAULT_W = 360

/** loadAgentPanelWidth 读取侧栏宽度。 */
function loadAgentPanelWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10)
    if (v >= MIN_W && v <= MAX_W) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_W
}

/** useAgentPanelResize AI 侧栏宽度拖拽。 */
export function useAgentPanelResize() {
  const [width, setWidth] = useState(loadAgentPanelWidth)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startW.current = width
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX
      const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(w))
        } catch {
          /* ignore */
        }
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return { width, onResizeStart }
}

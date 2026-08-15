/** 通用面板尺寸拖拽（像素），支持持久化 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type ResizeAxis = 'x' | 'y'

export type UseResizableOptions = {
  storageKey: string
  defaultSize: number
  min: number
  max: number
  axis: ResizeAxis
  /** 向左/向上拖时增大（右侧栏、底栏） */
  invert?: boolean
}

function loadSize(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? '', 10)
    if (Number.isFinite(v) && v >= min && v <= max) return v
  } catch {
    /* ignore */
  }
  return fallback
}

function saveSize(key: string, size: number) {
  try {
    localStorage.setItem(key, String(size))
  } catch {
    /* ignore */
  }
}

/** useResizable 拖拽调整单一尺寸。 */
export function useResizable(opts: UseResizableOptions) {
  const { storageKey, defaultSize, min, max, axis, invert = false } = opts
  const [size, setSize] = useState(() => loadSize(storageKey, defaultSize, min, max))
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const setSizeAndSave = useCallback(
    (next: number) => {
      const clamped = Math.min(max, Math.max(min, next))
      setSize(clamped)
      saveSize(storageKey, clamped)
    },
    [max, min, storageKey],
  )

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragging.current = true
      startPos.current = axis === 'x' ? e.clientX : e.clientY
      startSize.current = size
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.body.classList.add(axis === 'x' ? 'is-col-resizing' : 'is-row-resizing')
    },
    [axis, size],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const pos = axis === 'x' ? e.clientX : e.clientY
      const delta = invert ? startPos.current - pos : pos - startPos.current
      const next = Math.min(max, Math.max(min, startSize.current + delta))
      setSize(next)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.classList.remove('is-col-resizing', 'is-row-resizing')
      setSize((s) => {
        saveSize(storageKey, s)
        return s
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [axis, invert, max, min, storageKey])

  return { size, setSize, setSizeAndSave, onResizeStart }
}

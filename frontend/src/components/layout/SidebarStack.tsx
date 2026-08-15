import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PaneGutter } from './PaneGutter'
import {
  loadCollapsedMap,
  loadSizeMap,
  saveCollapsedMap,
  saveSizeMap,
  type CollapsedMap,
  type SizeMap,
} from './layoutStorage'
import './layout.css'

const DEFAULT_COLLAPSED_SIZE = 32

export type StackSection = {
  id: string
  content: ReactNode
  /** 固定高度段；与 flex 二选一 */
  defaultSize?: number
  min?: number
  max?: number
  flex?: boolean
  /** 可收起：分隔条双击收起，状态与尺寸同层持久化 */
  collapsible?: boolean
  collapsedSize?: number
  railLabel?: string
  collapseLabel?: string
  expandLabel?: string
}

type Props = {
  storageKey: string
  sections: StackSection[]
  resizeTitle?: string
  collapseTitle?: string
  expandTitle?: string
}

function clampSize(sec: StackSection, value: number) {
  const min = sec.min ?? 64
  const max = sec.max ?? 480
  return Math.min(max, Math.max(min, value))
}

/** 侧栏内纵向多分段：段间拖拽与折叠同层 */
export function SidebarStack({
  storageKey,
  sections,
  resizeTitle,
  collapseTitle,
  expandTitle,
}: Props) {
  const [sizes, setSizes] = useState<SizeMap>(() => loadSizeMap(storageKey))
  const [collapsed, setCollapsed] = useState<CollapsedMap>(() => loadCollapsedMap(storageKey))
  const drag = useRef<{
    id: string
    startY: number
    startSize: number
    invert: boolean
    min: number
    max: number
  } | null>(null)

  const isCollapsed = (sec: StackSection) => Boolean(sec.collapsible && collapsed[sec.id])

  const resolved = (sec: StackSection) => {
    if (sec.flex) return undefined
    if (isCollapsed(sec)) return sec.collapsedSize ?? DEFAULT_COLLAPSED_SIZE
    return clampSize(sec, sizes[sec.id] ?? sec.defaultSize ?? 120)
  }

  const toggleCollapsed = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = { ...prev, [id]: !prev[id] }
        saveCollapsedMap(storageKey, next)
        return next
      })
    },
    [storageKey],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const delta = d.invert ? d.startY - e.clientY : e.clientY - d.startY
      const next = Math.min(d.max, Math.max(d.min, d.startSize + delta))
      setSizes((prev) => ({ ...prev, [d.id]: next }))
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.classList.remove('is-row-resizing')
      setSizes((prev) => {
        saveSizeMap(storageKey, prev)
        return prev
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [storageKey])

  const beginDrag = (sec: StackSection, invert: boolean, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isCollapsed(sec)) return
    const current = resolved(sec) ?? sec.defaultSize ?? 120
    drag.current = {
      id: sec.id,
      startY: e.clientY,
      startSize: current,
      invert,
      min: sec.min ?? 64,
      max: sec.max ?? 480,
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.body.classList.add('is-row-resizing')
  }

  return (
    <div className="wn-sidebar-stack">
      {sections.map((sec, i) => {
        const next = sections[i + 1]
        const folded = isCollapsed(sec)
        const h = resolved(sec)
        const foldCollapse = sec.collapseLabel ?? collapseTitle
        const foldExpand = sec.expandLabel ?? expandTitle

        if (folded) {
          return (
            <div key={sec.id} className="wn-sidebar-stack-chunk is-collapsed">
              <div
                className="wn-sidebar-stack-pane is-collapsed-rail"
                style={{ height: h }}
              >
                <PaneGutter
                  axis="y"
                  collapsible
                  collapsed
                  railLabel={sec.railLabel}
                  onToggleCollapse={() => toggleCollapsed(sec.id)}
                  expandTitle={foldExpand}
                />
              </div>
            </div>
          )
        }

        return (
          <div key={sec.id} className="wn-sidebar-stack-chunk">
            <div
              className={`wn-sidebar-stack-pane${sec.flex ? ' is-flex' : ''}`}
              style={sec.flex ? undefined : { height: h }}
            >
              {sec.content}
            </div>
            {next && (
              <PaneGutter
                axis="y"
                resizeTitle={resizeTitle}
                collapsible={sec.collapsible}
                collapsed={false}
                railLabel={sec.railLabel}
                onToggleCollapse={sec.collapsible ? () => toggleCollapsed(sec.id) : undefined}
                collapseTitle={foldCollapse}
                expandTitle={foldExpand}
                onResizeMouseDown={(e) => {
                  if (!sec.flex) {
                    beginDrag(sec, false, e)
                    return
                  }
                  if (!next.flex) {
                    beginDrag(next, true, e)
                  }
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

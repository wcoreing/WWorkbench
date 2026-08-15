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

export type ColumnSection = {
  id: string
  content: ReactNode
  /** 固定宽度段；与 flex 二选一 */
  defaultSize?: number
  min?: number
  max?: number
  flex?: boolean
  /** 可收起：分隔条双击收起，状态与尺寸同层持久化 */
  collapsible?: boolean
  collapsedSize?: number
  /** 收起轨短标题 */
  railLabel?: string
  collapseLabel?: string
  expandLabel?: string
}

type Props = {
  storageKey: string
  sections: ColumnSection[]
  resizeTitle?: string
  collapseTitle?: string
  expandTitle?: string
  className?: string
  /** 受控折叠表；与 usePaneCollapse 共用时可在标题栏放收起按钮 */
  collapsed?: CollapsedMap
  onCollapsedChange?: (next: CollapsedMap) => void
}

function clampSize(sec: ColumnSection, value: number) {
  const min = sec.min ?? 96
  const max = sec.max ?? 420
  return Math.min(max, Math.max(min, value))
}

/** 侧栏内横向多分栏：栏间拖拽与折叠同层 */
export function SidebarColumns({
  storageKey,
  sections,
  resizeTitle,
  collapseTitle,
  expandTitle,
  className,
  collapsed: collapsedProp,
  onCollapsedChange,
}: Props) {
  const [sizes, setSizes] = useState<SizeMap>(() => loadSizeMap(storageKey))
  const [collapsedInner, setCollapsedInner] = useState<CollapsedMap>(() => loadCollapsedMap(storageKey))
  const collapsed = collapsedProp ?? collapsedInner
  const drag = useRef<{
    id: string
    startX: number
    startSize: number
    invert: boolean
    min: number
    max: number
  } | null>(null)

  const isCollapsed = (sec: ColumnSection) => Boolean(sec.collapsible && collapsed[sec.id])

  const resolved = (sec: ColumnSection) => {
    if (sec.flex) return undefined
    if (isCollapsed(sec)) return sec.collapsedSize ?? DEFAULT_COLLAPSED_SIZE
    return clampSize(sec, sizes[sec.id] ?? sec.defaultSize ?? 160)
  }

  const toggleCollapsed = useCallback(
    (id: string) => {
      if (onCollapsedChange) {
        onCollapsedChange({ ...collapsed, [id]: !collapsed[id] })
        return
      }
      setCollapsedInner((prev) => {
        const next = { ...prev, [id]: !prev[id] }
        saveCollapsedMap(storageKey, next)
        return next
      })
    },
    [collapsed, onCollapsedChange, storageKey],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const delta = d.invert ? d.startX - e.clientX : e.clientX - d.startX
      const next = Math.min(d.max, Math.max(d.min, d.startSize + delta))
      setSizes((prev) => ({ ...prev, [d.id]: next }))
    }
    const onUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.classList.remove('is-col-resizing')
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

  const beginDrag = (sec: ColumnSection, invert: boolean, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isCollapsed(sec)) return
    const current = resolved(sec) ?? sec.defaultSize ?? 160
    drag.current = {
      id: sec.id,
      startX: e.clientX,
      startSize: current,
      invert,
      min: sec.min ?? 96,
      max: sec.max ?? 420,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.classList.add('is-col-resizing')
  }

  return (
    <div className={['wn-sidebar-columns', className].filter(Boolean).join(' ')}>
      {sections.map((sec, i) => {
        const next = sections[i + 1]
        const folded = isCollapsed(sec)
        const w = resolved(sec)
        const foldCollapse = sec.collapseLabel ?? collapseTitle
        const foldExpand = sec.expandLabel ?? expandTitle

        if (folded) {
          return (
            <div key={sec.id} className="wn-sidebar-columns-chunk is-collapsed">
              <div
                className="wn-sidebar-columns-pane is-collapsed-rail"
                style={{ width: w }}
              >
                <PaneGutter
                  axis="x"
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
          <div key={sec.id} className="wn-sidebar-columns-chunk">
            <div
              className={`wn-sidebar-columns-pane${sec.flex ? ' is-flex' : ''}`}
              style={sec.flex ? undefined : { width: w }}
            >
              {sec.content}
            </div>
            {next && (
              <PaneGutter
                axis="x"
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

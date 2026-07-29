import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'

export const MIN_COL_WIDTH = 56
export const DEFAULT_COL_WIDTH = 140
export const INDEX_COL_WIDTH = 40
export const ACTIONS_COL_WIDTH = 64

const RESIZING_CLASS = 'is-col-resizing'

export type ColPart = { key: string; fallback?: number }

/** dataColParts 数据列 ColPart 列表。 */
export function dataColParts(names: string[]): ColPart[] {
  return names.map((name) => ({ key: name, fallback: DEFAULT_COL_WIDTH }))
}

/**
 * useColumnWidths
 * - 每列始终有像素宽（默认 140），避免被压扁看不到后面的列
 * - 表宽 max(100%, 列宽总和)：少列占满，多列横向滚动
 */
export function useColumnWidths() {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const widthsRef = useRef(widths)
  widthsRef.current = widths
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      document.body.classList.remove(RESIZING_CLASS)
    }
  }, [])

  const resolvedWidth = useCallback(
    (key: string, fallback = DEFAULT_COL_WIDTH) => widths[key] ?? fallback,
    [widths],
  )

  const colStyle = useCallback(
    (key: string, fallback = DEFAULT_COL_WIDTH): CSSProperties => ({
      width: resolvedWidth(key, fallback),
    }),
    [resolvedWidth],
  )

  const tableStyle = useCallback(
    (parts: ColPart[]): CSSProperties => {
      const sum = parts.reduce((s, p) => s + resolvedWidth(p.key, p.fallback ?? DEFAULT_COL_WIDTH), 0)
      return { width: `max(100%, ${sum}px)` }
    },
    [resolvedWidth],
  )

  const onResizeStart = useCallback((key: string, e: MouseEvent, fallback = DEFAULT_COL_WIDTH) => {
    e.preventDefault()
    e.stopPropagation()
    dragCleanupRef.current?.()

    const th = (e.currentTarget as HTMLElement).closest('th')
    const startW =
      widthsRef.current[key] ?? Math.round(th?.getBoundingClientRect().width ?? fallback)
    const startX = e.clientX
    document.body.classList.add(RESIZING_CLASS)

    const onMove = (ev: globalThis.MouseEvent) => {
      const w = Math.max(MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX))
      setWidths((prev) => (prev[key] === w ? prev : { ...prev, [key]: w }))
    }
    const onUp = () => {
      document.body.classList.remove(RESIZING_CLASS)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragCleanupRef.current = null
    }
    dragCleanupRef.current = onUp
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return { colStyle, tableStyle, onResizeStart }
}

/** ColResizeHandle 列头右缘拖拽手柄。 */
export function ColResizeHandle({ onMouseDown }: { onMouseDown: (e: MouseEvent) => void }) {
  return (
    <span
      className="col-resize-handle"
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="拖动调整列宽"
    />
  )
}

/** ResizableTh 可拖宽列头（含手柄）。 */
export function ResizableTh({
  colKey,
  className,
  title,
  onClick,
  onResizeStart,
  children,
}: {
  colKey: string
  className?: string
  title?: string
  onClick?: (e: MouseEvent) => void
  onResizeStart: (key: string, e: MouseEvent, fallback?: number) => void
  children: ReactNode
}) {
  return (
    <th className={className} title={title} onClick={onClick}>
      {children}
      <ColResizeHandle onMouseDown={(e) => onResizeStart(colKey, e)} />
    </th>
  )
}

/** GridColgroup 按 ColPart 渲染 colgroup。 */
export function GridColgroup({
  parts,
  colStyle,
}: {
  parts: ColPart[]
  colStyle: (key: string, fallback?: number) => CSSProperties
}) {
  return (
    <colgroup>
      {parts.map((p) => (
        <col key={p.key} style={colStyle(p.key, p.fallback ?? DEFAULT_COL_WIDTH)} />
      ))}
    </colgroup>
  )
}

/** WnGrid 表格外壳：横向滚动容器 + 定宽/占满逻辑。 */
export function WnGrid({
  parts,
  colStyle,
  tableStyle,
  header,
  children,
}: {
  parts: ColPart[]
  colStyle: (key: string, fallback?: number) => CSSProperties
  tableStyle: (parts: ColPart[]) => CSSProperties
  header: ReactNode
  children: ReactNode
}) {
  return (
    <div className="wn-grid-wrap">
      <table className="wn-grid" style={tableStyle(parts)}>
        <GridColgroup parts={parts} colStyle={colStyle} />
        <thead>
          <tr>{header}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

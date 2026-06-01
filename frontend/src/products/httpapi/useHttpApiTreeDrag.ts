import { useCallback, useEffect, useRef, useState } from 'react'
import type { HttpDragPayload, HttpDropTarget, HttpLayoutEntryKey } from './httpapiSort'
import { parseEntryKey } from './httpapiSort'

/** HTTP_FOLDER_DROP_ATTR 目录拖放区（移入该目录）。 */
export const HTTP_FOLDER_DROP_ATTR = 'data-http-folder-id'

/** HTTP_DROP_PARENT_ATTR 排序投放区父级 id（空串为根）。 */
export const HTTP_DROP_PARENT_ATTR = 'data-http-drop-parent'

/** HTTP_DROP_BEFORE_ATTR 插入位置（folder:id / api:id / __end__）。 */
export const HTTP_DROP_BEFORE_ATTR = 'data-http-drop-before'

const DRAG_THRESHOLD_PX = 6
const BODY_DRAG_CLASS = 'httpapi-tree-dragging'

export type HttpTreeDragGhost = {
  x: number
  y: number
  label: string
  kind: 'folder' | 'api'
  method?: string
}

interface DragMeta {
  label: string
  kind: 'folder' | 'api'
  method?: string
}

interface Options {
  batchMode: boolean
  onDrop: (drag: HttpDragPayload, target: HttpDropTarget) => void | Promise<void>
}

/** useHttpApiTreeDrag 目录/接口统一指针拖拽（排序槽 + 移入目录）。 */
export function useHttpApiTreeDrag({ batchMode, onDrop }: Options) {
  const [dragging, setDragging] = useState<HttpDragPayload | null>(null)
  const [dropTarget, setDropTarget] = useState<HttpDropTarget | null>(null)
  const [dragGhost, setDragGhost] = useState<HttpTreeDragGhost | null>(null)
  const dragSessionRef = useRef(false)

  /** resolveDropFromPoint 解析投放目标（优先排序槽，其次目录行，最后根）。 */
  const resolveDropFromPoint = useCallback((x: number, y: number): HttpDropTarget | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const slot = el.closest('.httpapi-drop-slot')
      if (slot) {
        const parentId = slot.getAttribute(HTTP_DROP_PARENT_ATTR) ?? ''
        const before = slot.getAttribute(HTTP_DROP_BEFORE_ATTR) ?? '__end__'
        if (before === '__end__') {
          return { mode: 'before', parentId, beforeKey: '__end__' }
        }
        const parsed = parseEntryKey(before)
        if (parsed) {
          return {
            mode: 'before',
            parentId,
            beforeKey: `${parsed.kind}:${parsed.id}` as HttpLayoutEntryKey,
          }
        }
      }
      if (el.closest('.httpapi-tree-api, .httpapi-tree-folder')) continue
      const zone = el.closest(`[${HTTP_FOLDER_DROP_ATTR}]`)
      if (zone) {
        const folderId = zone.getAttribute(HTTP_FOLDER_DROP_ATTR) ?? ''
        return { mode: 'into', parentId: folderId }
      }
    }
    const body = document.querySelector('.httpapi-tree-body')
    if (body) {
      const r = body.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { mode: 'into', parentId: '' }
      }
    }
    return null
  }, [])

  const resetDragUi = useCallback(() => {
    setDragging(null)
    setDropTarget(null)
    setDragGhost(null)
  }, [])

  const endDragSession = useCallback(() => {
    document.body.classList.remove(BODY_DRAG_CLASS)
    dragSessionRef.current = false
    resetDragUi()
  }, [resetDragUi])

  useEffect(() => () => endDragSession(), [endDragSession])

  /** startPointerDrag 在树行按下指针开始拖拽。 */
  const startPointerDrag = useCallback(
    (payload: HttpDragPayload, meta: DragMeta, e: React.PointerEvent) => {
      if (batchMode || e.button !== 0) return
      if ((e.target as HTMLElement).closest('input, button')) return

      const captureEl = e.currentTarget as HTMLElement
      const startX = e.clientX
      const startY = e.clientY
      let active = false

      const onMove = (ev: PointerEvent) => {
        if (!active) {
          if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) {
            return
          }
          active = true
          dragSessionRef.current = true
          document.body.classList.add(BODY_DRAG_CLASS)
          setDragging(payload)
          try {
            captureEl.setPointerCapture(ev.pointerId)
          } catch {
            /* 忽略 */
          }
        }
        ev.preventDefault()
        setDragGhost({
          x: ev.clientX + 12,
          y: ev.clientY + 10,
          label: meta.label,
          kind: meta.kind,
          method: meta.method,
        })
        setDropTarget(resolveDropFromPoint(ev.clientX, ev.clientY))
      }

      const finish = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        try {
          captureEl.releasePointerCapture(ev.pointerId)
        } catch {
          /* 忽略 */
        }
        if (active) {
          ev.preventDefault()
          const target = resolveDropFromPoint(ev.clientX, ev.clientY)
          if (target) void onDrop(payload, target)
          window.setTimeout(() => {
            dragSessionRef.current = false
            document.body.classList.remove(BODY_DRAG_CLASS)
          }, 0)
        } else {
          dragSessionRef.current = false
          document.body.classList.remove(BODY_DRAG_CLASS)
        }
        resetDragUi()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [batchMode, onDrop, resolveDropFromPoint, resetDragUi],
  )

  /** onFolderPointerDown 目录行拖拽。 */
  const onFolderPointerDown = useCallback(
    (folderId: string, name: string, e: React.PointerEvent) => {
      startPointerDrag({ kind: 'folder', id: folderId }, { kind: 'folder', label: name }, e)
    },
    [startPointerDrag],
  )

  /** onApiPointerDown 接口行拖拽。 */
  const onApiPointerDown = useCallback(
    (apiId: string, meta: { label: string; method: string }, e: React.PointerEvent) => {
      startPointerDrag(
        { kind: 'api', id: apiId },
        { kind: 'api', label: meta.label, method: meta.method },
        e,
      )
    },
    [startPointerDrag],
  )

  /** shouldIgnoreTreeClick 拖拽会话中忽略树 click。 */
  const shouldIgnoreTreeClick = useCallback(() => dragSessionRef.current, [])

  /** isDropHighlightFolder 目录行是否为移入高亮目标。 */
  const isDropHighlightFolder = useCallback(
    (folderId: string) =>
      dropTarget?.mode === 'into' && (dropTarget.parentId || '') === (folderId || ''),
    [dropTarget],
  )

  /** isDropHighlightRoot 根区域是否为移入高亮。 */
  const isDropHighlightRoot = useCallback(
    () => dropTarget?.mode === 'into' && dropTarget.parentId === '',
    [dropTarget],
  )

  /** isActiveDropSlot 排序槽是否高亮。 */
  const isActiveDropSlot = useCallback(
    (parentId: string, beforeKey: string) =>
      dropTarget?.mode === 'before' &&
      (dropTarget.parentId || '') === (parentId || '') &&
      dropTarget.beforeKey === beforeKey,
    [dropTarget],
  )

  const isDragging = dragging != null

  return {
    dragging,
    dropTarget,
    dragGhost,
    isDragging,
    onFolderPointerDown,
    onApiPointerDown,
    shouldIgnoreTreeClick,
    isDropHighlightFolder,
    isDropHighlightRoot,
    isActiveDropSlot,
  }
}

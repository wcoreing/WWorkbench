import { useCallback, useState } from 'react'
import {
  loadCollapsedMap,
  saveCollapsedMap,
  type CollapsedMap,
} from './layoutStorage'

/** 与 SidebarColumns/Stack 共用的折叠状态（含持久化） */
export function usePaneCollapse(storageKey: string) {
  const [collapsed, setCollapsedState] = useState<CollapsedMap>(() => loadCollapsedMap(storageKey))

  const setCollapsed = useCallback(
    (next: CollapsedMap) => {
      setCollapsedState(next)
      saveCollapsedMap(storageKey, next)
    },
    [storageKey],
  )

  const togglePane = useCallback(
    (id: string) => {
      setCollapsedState((prev) => {
        const next = { ...prev, [id]: !prev[id] }
        saveCollapsedMap(storageKey, next)
        return next
      })
    },
    [storageKey],
  )

  return { collapsed, setCollapsed, togglePane }
}

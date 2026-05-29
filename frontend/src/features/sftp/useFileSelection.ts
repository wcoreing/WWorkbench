import { useCallback, useRef, useState } from 'react'
import type { FileEntry } from '../../api/types'

/** useFileSelection 文件列表多选（Ctrl/Cmd 切换、Shift 范围选） */
export function useFileSelection(entries: FileEntry[]) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const anchorRef = useRef(0)

  const clearSelection = useCallback(() => {
    setSelectedPaths([])
  }, [])

  const selectedEntries = entries.filter((e) => selectedPaths.includes(e.path))

  const handleRowClick = useCallback(
    (entry: FileEntry, index: number, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        setSelectedPaths((prev) =>
          prev.includes(entry.path) ? prev.filter((p) => p !== entry.path) : [...prev, entry.path]
        )
        anchorRef.current = index
        return
      }
      if (e.shiftKey && entries.length > 0) {
        const from = Math.min(anchorRef.current, index)
        const to = Math.max(anchorRef.current, index)
        const range = entries.slice(from, to + 1).map((f) => f.path)
        setSelectedPaths(range)
        return
      }
      anchorRef.current = index
      setSelectedPaths([entry.path])
    },
    [entries]
  )

  return { selectedPaths, selectedEntries, handleRowClick, clearSelection, setSelectedPaths }
}

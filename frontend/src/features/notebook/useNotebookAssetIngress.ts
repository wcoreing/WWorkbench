import { useEffect, useRef, useState, type DragEvent } from 'react'
import { bindOsFileDrop } from '../../utils/osFileDrop'
import { collectLocalFilePaths, collectTransferFiles } from './notebookAssets'

type Handlers = {
  enabled: boolean
  onFiles: (files: File[]) => void
  onPaths: (paths: string[]) => void
}

/** useNotebookAssetIngress 笔记编辑/预览区接收截图粘贴与本机文件拖入。 */
export function useNotebookAssetIngress({ enabled, onFiles, onPaths }: Handlers) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const onFilesRef = useRef(onFiles)
  const onPathsRef = useRef(onPaths)
  const domDropAt = useRef(0)
  onFilesRef.current = onFiles
  onPathsRef.current = onPaths

  useEffect(() => {
    if (!enabled || !host) return
    const onPaste = (e: ClipboardEvent) => {
      const files = collectTransferFiles(e.clipboardData)
      const paths = files.length ? [] : collectLocalFilePaths(e.clipboardData)
      if (!files.length && !paths.length) return
      e.preventDefault()
      e.stopPropagation()
      if (files.length) onFilesRef.current(files)
      else onPathsRef.current(paths)
    }
    host.addEventListener('paste', onPaste, true)
    return () => host.removeEventListener('paste', onPaste, true)
  }, [enabled, host])

  useEffect(() => {
    if (!enabled || !host) return
    return bindOsFileDrop((x, y, paths) => {
      const hit = document.elementFromPoint(x, y)
      if (!hit || !host.contains(hit)) return false
      if (Date.now() - domDropAt.current < 1200) return true
      onPathsRef.current(paths)
      return true
    })
  }, [enabled, host])

  const onDragOver = (e: DragEvent) => {
    if (!enabled || ![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }

  const onDrop = (e: DragEvent) => {
    if (!enabled) return
    setDragOver(false)
    const files = collectTransferFiles(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    domDropAt.current = Date.now()
    onFilesRef.current(files)
  }

  return { setHost, dragOver, onDragOver, onDragLeave, onDrop }
}

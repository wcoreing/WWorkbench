import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import type { NoteLanguage } from '../../api/types'
import { collectTransferFiles } from './notebookAssets'
import { DEFAULT_NOTEBOOK_EDITOR_FONT } from './notebookEditorFont'

export interface NoteEditorHandle {
  /** getSelectedText 获取选中文本，无选区则返回全文。 */
  getSelectedText: () => string
  /** insertText 在光标处插入文本并恢复焦点。 */
  insertText: (text: string) => void
  /** focus 聚焦编辑区。 */
  focus: () => void
}

interface Props {
  noteId: string
  language: NoteLanguage
  content: string
  editorFontSize?: number
  onChange: (content: string) => void
  onRunSelection?: () => void
  /** onInsertFiles 粘贴/拖入文件时上传并插入 Markdown。 */
  onInsertFiles?: (files: File[]) => void | Promise<void>
}

/**
 * NoteEditor 笔记源码编辑区。
 * 使用原生 textarea，避开 Monaco 在壳层 CSS zoom / 中文 IME 下的折行错位。
 */
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  {
    noteId,
    language,
    content,
    editorFontSize = DEFAULT_NOTEBOOK_EDITOR_FONT,
    onChange,
    onRunSelection,
    onInsertFiles,
  },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const onRunSelectionRef = useRef(onRunSelection)
  onRunSelectionRef.current = onRunSelection
  const onInsertFilesRef = useRef(onInsertFiles)
  onInsertFilesRef.current = onInsertFiles
  const [dragOver, setDragOver] = useState(false)

  const insertText = useCallback(
    (text: string) => {
      if (!text) return
      const el = taRef.current
      if (!el) {
        onChange(content + text)
        return
      }
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`
      onChange(next)
      const cursor = start + text.length
      requestAnimationFrame(() => {
        el.focus()
        el.selectionStart = el.selectionEnd = cursor
      })
    },
    [content, onChange],
  )

  useImperativeHandle(
    ref,
    () => ({
      getSelectedText: () => {
        const el = taRef.current
        if (!el) return content
        const { selectionStart, selectionEnd, value } = el
        if (selectionStart === selectionEnd) return value
        return value.slice(selectionStart, selectionEnd).trim() || value
      },
      insertText,
      focus: () => taRef.current?.focus(),
    }),
    [content, insertText],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onRunSelectionRef.current?.()
        return
      }
      if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = `${el.value.slice(0, start)}  ${el.value.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    },
    [onChange],
  )

  const takeFiles = useCallback((dt: DataTransfer | null) => {
    const files = collectTransferFiles(dt)
    if (!files.length || !onInsertFilesRef.current) return false
    void onInsertFilesRef.current(files)
    return true
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      setDragOver(false)
      if (!takeFiles(e.dataTransfer)) return
      e.preventDefault()
    },
    [takeFiles],
  )

  return (
    <div
      className={`note-editor-wrap${dragOver ? ' is-drag-over' : ''}`}
      data-ww-focus-hog=""
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <textarea
        key={noteId}
        ref={taRef}
        className="note-editor-textarea"
        value={content}
        spellCheck={language === 'markdown' || language === 'plaintext'}
        wrap="soft"
        style={{ fontSize: editorFontSize, lineHeight: 1.7 }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          if (takeFiles(e.clipboardData)) e.preventDefault()
        }}
        aria-label={language}
      />
    </div>
  )
})

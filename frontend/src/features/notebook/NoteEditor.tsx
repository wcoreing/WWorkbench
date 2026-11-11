import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { NoteLanguage } from '../../api/types'
import { bindSelectionGuard, zoomCompensatedPx } from '../../components/compat'
import { useContainerHeight } from '../../hooks/useContainerHeight'
import { useAppStore } from '../../stores/appStore'
import { collectTransferFiles } from './notebookAssets'
import { DEFAULT_NOTEBOOK_EDITOR_FONT } from './notebookEditorFont'
import { monacoLanguageForNote } from './noteFileTypes'

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

type MonacoNS = typeof import('monaco-editor')

/**
 * NoteEditor IDE 源码编辑区（Monaco）。
 * 与 SQL/SFTP 同套：ww-zoom-content + zoomCompensatedPx，避开壳层 CSS zoom 错位。
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
  const theme = useAppStore((s) => s.theme)
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<MonacoNS | null>(null)
  const onRunSelectionRef = useRef(onRunSelection)
  onRunSelectionRef.current = onRunSelection
  const onInsertFilesRef = useRef(onInsertFiles)
  onInsertFilesRef.current = onInsertFiles
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const contentRef = useRef(content)
  contentRef.current = content
  const [dragOver, setDragOver] = useState(false)
  const editorHeight = useContainerHeight(hostRef, 120)
  const fontSize = zoomCompensatedPx(editorFontSize, uiFontSize)
  const lineHeight = zoomCompensatedPx(Math.round(editorFontSize * 1.7), uiFontSize)
  const monacoLang = monacoLanguageForNote(language)

  useImperativeHandle(
    ref,
    () => ({
      getSelectedText: () => {
        const ed = editorRef.current
        if (!ed) return contentRef.current
        const selection = ed.getSelection()
        const model = ed.getModel()
        if (!selection || !model || selection.isEmpty()) return ed.getValue()
        return model.getValueInRange(selection).trim() || ed.getValue()
      },
      insertText: (text: string) => {
        if (!text) return
        const ed = editorRef.current
        if (!ed) {
          onChangeRef.current(contentRef.current + text)
          return
        }
        const selection = ed.getSelection()
        const model = ed.getModel()
        if (!model) return
        if (!selection) {
          const end = model.getFullModelRange().getEndPosition()
          ed.executeEdits('insert', [
            {
              range: {
                startLineNumber: end.lineNumber,
                startColumn: end.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column,
              },
              text,
            },
          ])
        } else {
          ed.executeEdits('insert', [{ range: selection, text }])
        }
        ed.focus()
      },
      focus: () => editorRef.current?.focus(),
    }),
    [],
  )

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, lineHeight })
  }, [fontSize, lineHeight])

  useEffect(() => {
    const ed = editorRef.current
    const monaco = monacoRef.current
    const model = ed?.getModel()
    if (!ed || !monaco || !model) return
    monaco.editor.setModelLanguage(model, monacoLang)
  }, [monacoLang])

  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    if (ed.getValue() !== content) {
      ed.setValue(content)
    }
  }, [content, noteId])

  const takeFiles = useCallback((dt: DataTransfer | null) => {
    const files = collectTransferFiles(dt)
    if (!files.length || !onInsertFilesRef.current) return false
    void onInsertFilesRef.current(files)
    return true
  }, [])

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco
    if (editorInstance.getValue() !== contentRef.current) {
      editorInstance.setValue(contentRef.current)
    }
    const model = editorInstance.getModel()
    if (model) monaco.editor.setModelLanguage(model, monacoLanguageForNote(language))
    editorInstance.addAction({
      id: 'notebook-run-selection',
      label: 'Run selection',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRunSelectionRef.current?.(),
    })
    const dom = editorInstance.getDomNode()
    if (!dom) return
    const onPaste = (e: ClipboardEvent) => {
      if (takeFiles(e.clipboardData)) e.preventDefault()
    }
    dom.addEventListener('paste', onPaste)
    const unbind = bindSelectionGuard(dom, () => {
      const pos = editorInstance.getPosition()
      if (!pos) return
      editorInstance.setSelection(monaco.Selection.fromPositions(pos, pos))
    })
    editorInstance.onDidDispose(() => {
      unbind()
      dom.removeEventListener('paste', onPaste)
    })
  }

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
      <div ref={hostRef} className="note-editor-host ww-zoom-content">
        <Editor
          key={noteId}
          height={editorHeight}
          language={monacoLang}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={content}
          onChange={(v) => onChange(v || '')}
          loading={<div className="empty-hint">…</div>}
          options={{
            minimap: { enabled: false },
            fontSize,
            lineHeight,
            fontFamily: 'var(--font-mono)',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'line',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            tabSize: 2,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
          onMount={onMount}
        />
      </div>
    </div>
  )
})

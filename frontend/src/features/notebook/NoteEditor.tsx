import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { NoteLanguage } from '../../api/types'
import { bindSelectionGuard, zoomCompensatedPx } from '../../components/compat'
import { useContainerHeight } from '../../hooks/useContainerHeight'
import { useAppStore } from '../../stores/appStore'

const BASE_FONT_PX = 13
const BASE_LINE_PX = 20

export interface NoteEditorHandle {
  /** getSelectedText 获取选中文本，无选区则返回全文。 */
  getSelectedText: () => string
}

interface Props {
  noteId: string
  language: NoteLanguage
  content: string
  onChange: (content: string) => void
  onRunSelection?: () => void
}

/** NoteEditor Monaco 笔记编辑区。 */
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  { noteId, language, content, onChange, onRunSelection },
  ref
) {
  const theme = useAppStore((s) => s.theme)
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const contentRef = useRef(content)
  const onRunSelectionRef = useRef(onRunSelection)
  onChangeRef.current = onChange
  contentRef.current = content
  onRunSelectionRef.current = onRunSelection
  const editorHeight = useContainerHeight(editorHostRef, 120)
  const fontSize = zoomCompensatedPx(BASE_FONT_PX, uiFontSize)
  const lineHeight = zoomCompensatedPx(BASE_LINE_PX, uiFontSize)

  useImperativeHandle(ref, () => ({
    getSelectedText: () => {
      const ed = editorRef.current
      if (!ed) return contentRef.current
      const selection = ed.getSelection()
      const model = ed.getModel()
      if (!selection || !model || selection.isEmpty()) {
        return ed.getValue()
      }
      return model.getValueInRange(selection).trim() || ed.getValue()
    },
  }))

  const handleChange = useCallback((v?: string) => {
    const next = v || ''
    if (next === contentRef.current) return
    onChangeRef.current(next)
  }, [])

  const options = useMemo(
    () => ({
      minimap: { enabled: false },
      fontSize,
      lineHeight,
      fontFamily: 'var(--font-mono)',
      wordWrap: 'on' as const,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: 'line' as const,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    }),
    [fontSize, lineHeight],
  )

  const onMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance
    editorInstance.addAction({
      id: 'run-note-selection',
      label: 'Run in Terminal',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRunSelectionRef.current?.(),
    })
    const dom = editorInstance.getDomNode()
    if (!dom) return
    const unbind = bindSelectionGuard(dom, () => {
      const pos = editorInstance.getPosition()
      if (!pos) return
      editorInstance.setSelection(monaco.Selection.fromPositions(pos, pos))
    })
    editorInstance.onDidDispose(unbind)
  }, [])

  return (
    <div className="note-editor-wrap" data-ww-focus-hog="">
      <div ref={editorHostRef} className="note-editor-host ww-zoom-content">
        <Editor
          key={noteId}
          height={editorHeight}
          language={language}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={content}
          onChange={handleChange}
          loading={<div className="empty-hint">加载编辑器…</div>}
          options={options}
          onMount={onMount}
        />
      </div>
    </div>
  )
})

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import Editor, { type OnMount } from '@monaco-editor/react'
import { scrollRatio } from './useMdSplitScroll'
import type { NoteLanguage } from '../../api/types'
import { bindSelectionGuard } from '../../components/compat'
import { useContainerHeight } from '../../hooks/useContainerHeight'
import { useAppStore } from '../../stores/appStore'
import { isDarkTheme } from '../../theme/appTheme'
import { DEFAULT_NOTEBOOK_EDITOR_FONT } from './notebookEditorFont'
import { monacoLanguageForNote } from './noteFileTypes'

export interface NoteEditorHandle {
  /** getSelectedText 获取选中文本，无选区则返回全文。 */
  getSelectedText: () => string
  /** insertText 在光标处插入文本并恢复焦点。 */
  insertText: (text: string) => void
  /** focus 聚焦编辑区。 */
  focus: () => void
  /** scrollToRatio 按可见比例滚动，供双屏预览对齐。 */
  scrollToRatio: (ratio: number) => void
}

interface Props {
  noteId: string
  language: NoteLanguage
  content: string
  editorFontSize?: number
  onChange: (content: string) => void
  onRunSelection?: () => void
  /** onScrollRatio 编辑区纵向滚动比例，双屏时驱动预览。 */
  onScrollRatio?: (ratio: number) => void
  /** onBindScroll 交出按比例滚动的方法；编辑器卸载时传 null。返回是否实际滚动。 */
  onBindScroll?: (scrollToRatio: ((ratio: number) => boolean) | null) => void
}

type MonacoNS = typeof import('monaco-editor')

/** NoteEditor IDE 源码编辑区（Monaco；正文字号用笔记设置，不跟壳层 --ui-scale）。 */
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  {
    noteId,
    language,
    content,
    editorFontSize = DEFAULT_NOTEBOOK_EDITOR_FONT,
    onChange,
    onRunSelection,
    onScrollRatio,
    onBindScroll,
  },
  ref,
) {
  const theme = useAppStore((s) => s.theme)
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<MonacoNS | null>(null)
  const onRunSelectionRef = useRef(onRunSelection)
  onRunSelectionRef.current = onRunSelection
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onScrollRatioRef = useRef(onScrollRatio)
  onScrollRatioRef.current = onScrollRatio
  const onBindScrollRef = useRef(onBindScroll)
  onBindScrollRef.current = onBindScroll
  const contentRef = useRef(content)
  contentRef.current = content
  const editorHeight = useContainerHeight(hostRef, 120)
  const fontSize = Math.max(10, Math.round(editorFontSize))
  const lineHeight = Math.max(14, Math.round(editorFontSize * 1.7))
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
      scrollToRatio: (ratio: number) => {
        const ed = editorRef.current
        if (ed) scrollEditorToRatio(ed, ratio)
      },
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
    const scrollSub = editorInstance.onDidScrollChange((e) => {
      if (!e.scrollTopChanged) return
      onScrollRatioRef.current?.(editorScrollRatio(editorInstance))
    })
    onBindScrollRef.current?.((ratio) => scrollEditorToRatio(editorInstance, ratio))
    const dom = editorInstance.getDomNode()
    const unbind = dom
      ? bindSelectionGuard(dom, () => {
          const pos = editorInstance.getPosition()
          if (!pos) return
          editorInstance.setSelection(monaco.Selection.fromPositions(pos, pos))
        })
      : () => undefined
    editorInstance.onDidDispose(() => {
      unbind()
      scrollSub.dispose()
      onBindScrollRef.current?.(null)
    })
  }

  return (
    <div className="note-editor-wrap" data-ww-focus-hog="">
      <div ref={hostRef} className="note-editor-host">
        <Editor
          key={noteId}
          height={editorHeight}
          language={monacoLang}
          theme={isDarkTheme(theme) ? 'vs-dark' : 'vs'}
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
            fixedOverflowWidgets: false,
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

function editorScrollRatio(ed: monacoEditor.IStandaloneCodeEditor): number {
  const height = ed.getLayoutInfo().height
  return scrollRatio(ed.getScrollTop(), ed.getScrollHeight(), height)
}

function scrollEditorToRatio(ed: monacoEditor.IStandaloneCodeEditor, ratio: number): boolean {
  const height = ed.getLayoutInfo().height
  const max = Math.max(0, ed.getScrollHeight() - height)
  const next = ratio * max
  if (Math.abs(ed.getScrollTop() - next) < 1) return false
  ed.setScrollTop(next)
  return true
}

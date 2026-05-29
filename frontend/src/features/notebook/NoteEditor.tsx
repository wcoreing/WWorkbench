import { forwardRef, useImperativeHandle, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { NoteLanguage } from '../../api/types'
import { useContainerHeight } from '../../hooks/useContainerHeight'
import { useAppStore } from '../../stores/appStore'

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
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorHeight = useContainerHeight(editorHostRef, 120)

  useImperativeHandle(ref, () => ({
    getSelectedText: () => {
      const ed = editorRef.current
      if (!ed) return content
      const selection = ed.getSelection()
      const model = ed.getModel()
      if (!selection || !model || selection.isEmpty()) {
        return ed.getValue()
      }
      return model.getValueInRange(selection).trim() || ed.getValue()
    },
  }))

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    if (onRunSelection) {
      editorInstance.addAction({
        id: 'run-note-selection',
        label: 'Run in Terminal',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: onRunSelection,
      })
    }
  }

  return (
    <div className="note-editor-wrap">
      <div ref={editorHostRef} className="note-editor-host">
        <Editor
          key={noteId}
          height={editorHeight}
          language={language}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={content}
          onChange={(v) => onChange(v || '')}
          loading={<div className="empty-hint">加载编辑器…</div>}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 20,
            fontFamily: 'var(--font-mono)',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'line',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          }}
          onMount={onMount}
        />
      </div>
    </div>
  )
})

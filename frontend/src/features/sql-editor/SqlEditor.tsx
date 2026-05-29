import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useContainerHeight } from '../../hooks/useContainerHeight'
import { useAppStore } from '../../stores/appStore'

export interface SqlEditorHandle {
  /** getRunSQL 获取待执行的 SQL（有选区则返回选区，否则全文）。 */
  getRunSQL: () => string
}

interface Props {
  tabId: string
  sql: string
  onChange: (sql: string) => void
  onExecute: () => void
}

/** SqlEditor Monaco SQL 编辑区（运行快捷键 ⌘+Enter，工具栏在顶栏）。 */
export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { tabId, sql, onChange, onExecute },
  ref
) {
  const theme = useAppStore((s) => s.theme)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorHeight = useContainerHeight(editorHostRef, 120)

  useImperativeHandle(ref, () => ({
    getRunSQL: () => {
      const ed = editorRef.current
      if (!ed) return sql
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
    if (editorInstance.getValue() !== sql) {
      editorInstance.setValue(sql)
    }
    editorInstance.addAction({
      id: 'execute-sql',
      label: 'Execute SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: onExecute,
    })
  }

  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    const model = ed.getModel()
    if (model && model.getValue() !== sql) {
      ed.setValue(sql)
    }
  }, [sql, tabId])

  return (
    <div className="sql-editor-wrap">
      <div ref={editorHostRef} className="sql-editor-host">
        <Editor
          key={tabId}
          height={editorHeight}
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={sql}
          onChange={(v) => onChange(v || '')}
          loading={<div className="empty-hint">加载编辑器…</div>}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 18,
            fontFamily: 'var(--font-mono)',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 6, bottom: 6 },
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

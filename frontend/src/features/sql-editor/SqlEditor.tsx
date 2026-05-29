import Editor from '@monaco-editor/react'
import { useRef } from 'react'
import { useContainerHeight } from '../../hooks/useContainerHeight'
import { useAppStore } from '../../stores/appStore'

interface Props {
  tabId: string
  sql: string
  onChange: (sql: string) => void
  onExecute: () => void
}

/** SqlEditor Monaco SQL 编辑区（运行快捷键 ⌘+Enter，工具栏在顶栏）。 */
export function SqlEditor({ tabId, sql, onChange, onExecute }: Props) {
  const theme = useAppStore((s) => s.theme)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorHeight = useContainerHeight(editorHostRef, 120)

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
          onMount={(editor, monaco) => {
            editor.addAction({
              id: 'execute-sql',
              label: 'Execute SQL',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
              run: onExecute,
            })
          }}
        />
      </div>
    </div>
  )
}

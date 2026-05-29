import Editor from '@monaco-editor/react'
import { useAppStore } from '../../stores/appStore'
import '../../components/ui.css'

interface Props {
  tabId: string
  content: string
  editable: boolean
  onChange: (content: string) => void
  onExecute: () => void
}

/** DdlEditor DDL 编辑区（可编辑模式下支持执行）。 */
export function DdlEditor({ tabId, content, editable, onChange, onExecute }: Props) {
  const theme = useAppStore((s) => s.theme)

  if (!editable) {
    return <pre className="ddl-view">{content}</pre>
  }

  return (
    <div className="ddl-editor-wrap">
      <div className="pane-toolbar ddl-editor-toolbar">
        <div className="pane-toolbar-start">
          <span className="pane-meta">DDL 编辑器 · 修改后点击执行</span>
        </div>
        <div className="pane-toolbar-end">
          <button type="button" className="wn-btn wn-btn-tool wn-btn-accent" onClick={onExecute}>
            执行
          </button>
        </div>
      </div>
      <div className="ddl-editor-host">
        <Editor
          key={tabId}
          height="100%"
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={content}
          onChange={(v) => onChange(v || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 18,
            fontFamily: 'var(--font-mono)',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  )
}

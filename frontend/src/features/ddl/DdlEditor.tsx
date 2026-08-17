import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { bindSelectionGuard, zoomCompensatedPx } from '../../components/compat'
import { useAppStore } from '../../stores/appStore'
import '../../components/ui.css'

const BASE_FONT_PX = 12
const BASE_LINE_PX = 18

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
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const fontSize = zoomCompensatedPx(BASE_FONT_PX, uiFontSize)
  const lineHeight = zoomCompensatedPx(BASE_LINE_PX, uiFontSize)

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, lineHeight })
  }, [fontSize, lineHeight])

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    const dom = editorInstance.getDomNode()
    if (!dom) return
    const unbind = bindSelectionGuard(dom, () => {
      const pos = editorInstance.getPosition()
      if (!pos) return
      editorInstance.setSelection(monaco.Selection.fromPositions(pos, pos))
    })
    editorInstance.onDidDispose(unbind)
  }

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
      <div className="ddl-editor-host ww-zoom-content">
        <Editor
          key={tabId}
          height="100%"
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          value={content}
          onChange={(v) => onChange(v || '')}
          options={{
            minimap: { enabled: false },
            fontSize,
            lineHeight,
            fontFamily: 'var(--font-mono)',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
          }}
          onMount={onMount}
        />
      </div>
    </div>
  )
}

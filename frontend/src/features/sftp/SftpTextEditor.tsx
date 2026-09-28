import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { backdropDismissProps, pressProps, bindSelectionGuard, zoomCompensatedPx } from '../../components/compat'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { askConfirm } from '../../utils/askConfirm'
import { guessMonacoLanguage } from './sftpTextLanguage'

const BASE_FONT_PX = 13
const BASE_LINE_PX = 20

interface Props {
  open: boolean
  path: string
  name: string
  content: string
  /** 加载/保存成功后递增，用于清除 dirty。 */
  revision: number
  saving?: boolean
  onChange: (content: string) => void
  onSave: () => void
  onReload: () => void
  onClose: () => void
}

/** SftpTextEditor 宝塔式远程文本编辑弹窗（Monaco）。 */
export function SftpTextEditor({
  open,
  path,
  name,
  content,
  revision,
  saving = false,
  onChange,
  onSave,
  onReload,
  onClose,
}: Props) {
  const { t } = useI18n()
  const theme = useAppStore((s) => s.theme)
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [dirty, setDirty] = useState(false)
  const fontSize = zoomCompensatedPx(BASE_FONT_PX, uiFontSize)
  const lineHeight = zoomCompensatedPx(BASE_LINE_PX, uiFontSize)
  const language = guessMonacoLanguage(name)

  useEffect(() => {
    if (!open) return
    setDirty(false)
  }, [open, path, revision])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, lineHeight })
  }, [fontSize, lineHeight])

  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    if (ed.getValue() !== content) {
      ed.setValue(content)
    }
  }, [content, path, revision])

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? '')
      setDirty(true)
    },
    [onChange],
  )

  const requestClose = useCallback(async () => {
    if (dirty) {
      const ok = await askConfirm({
        title: t('sftp.editorDiscardTitle'),
        message: t('sftp.editorDiscardConfirm'),
        confirmLabel: t('sftp.editorDiscard'),
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [dirty, onClose, t])

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    editorInstance.addAction({
      id: 'sftp-save-text',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSave(),
    })
    const dom = editorInstance.getDomNode()
    if (!dom) return
    const unbind = bindSelectionGuard(dom, () => {
      const pos = editorInstance.getPosition()
      if (!pos) return
      editorInstance.setSelection(monaco.Selection.fromPositions(pos, pos))
    })
    editorInstance.onDidDispose(unbind)
  }

  if (!open) return null

  return (
    <div className="wn-modal-backdrop" {...backdropDismissProps(() => void requestClose())}>
      <div
        className="wn-modal wn-modal-xl sftp-text-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sftp-text-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wn-modal-header-bar sftp-text-editor-header">
          <h2 id="sftp-text-editor-title" className="wn-modal-title sftp-text-editor-title">
            {t('sftp.onlineEditor')}
            {dirty ? <span className="sftp-text-editor-dirty">•</span> : null}
          </h2>
          <button
            type="button"
            className="wn-modal-close-btn"
            aria-label={t('common.close')}
            {...pressProps(() => void requestClose())}
          >
            ×
          </button>
        </header>

        <div className="sftp-text-editor-toolbar">
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            disabled={saving || !dirty}
            {...pressProps(onSave, { disabled: saving || !dirty })}
          >
            {saving ? t('sftp.editorSaving') : t('sftp.editorSave')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-chrome"
            disabled={saving}
            {...pressProps(() => void onReload(), { disabled: saving })}
          >
            {t('common.refresh')}
          </button>
          <span className="sftp-text-editor-tab">{name}</span>
        </div>

        <div className="sftp-text-editor-host ww-zoom-content">
          <Editor
            height="100%"
            language={language}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={content}
            onChange={handleChange}
            onMount={onMount}
            options={{
              fontSize,
              lineHeight,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        </div>

        <footer className="sftp-text-editor-footer">
          <span className="sftp-text-editor-path" title={path}>
            {path}
          </span>
          <span>{language.toUpperCase()}</span>
          <span>UTF-8</span>
        </footer>
      </div>
    </div>
  )
}

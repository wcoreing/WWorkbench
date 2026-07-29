import { useEffect, useMemo, useState } from 'react'
import { ModalPortal } from '../../components/ModalPortal'
import { MarkdownPreview } from '../notebook/MarkdownPreview'
import { CellRichValue } from './CellRichValue'
import {
  cellStats,
  containsMarkdown,
  looksLikeMarkdown,
  normalizeMarkdownSource,
  tryFormatJson,
} from './formatCellValue'
import { pressProps } from '../../utils/press'
import '../../components/ui.css'

export interface CellViewerTarget {
  column: string
  value: string | null
  isNull?: boolean
  /** 可编辑时允许在弹窗内改值并回写。 */
  editable?: boolean
}

interface Props {
  target: CellViewerTarget | null
  onClose: () => void
  onApply?: (value: string | null) => void
}

/** CellViewerDialog 单元格完整内容查看（JSON 格式化 + 内部 Markdown 渲染）。 */
export function CellViewerDialog({ target, onClose, onApply }: Props) {
  const raw = target?.isNull ? null : (target?.value ?? null)
  const rawText = raw ?? ''
  const [pretty, setPretty] = useState(true)
  const [renderMd, setRenderMd] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [draft, setDraft] = useState(rawText)
  const [copied, setCopied] = useState(false)

  const editable = Boolean(target?.editable && onApply)
  const activeText = editable ? draft : rawText
  const json = useMemo(() => (activeText ? tryFormatJson(activeText) : null), [activeText])
  const mdCapable = useMemo(() => {
    if (!activeText) return false
    if (json?.ok) {
      if (typeof json.value === 'string') return looksLikeMarkdown(json.value)
      return containsMarkdown(json.value)
    }
    return looksLikeMarkdown(activeText)
  }, [activeText, json])

  useEffect(() => {
    if (!target) return
    setPretty(true)
    setWrap(true)
    setCopied(false)
    const text = target.isNull ? '' : (target.value ?? '')
    setDraft(text)
    const parsed = text ? tryFormatJson(text) : null
    if (parsed?.ok) {
      if (typeof parsed.value === 'string') setRenderMd(looksLikeMarkdown(parsed.value))
      else setRenderMd(containsMarkdown(parsed.value))
    } else {
      setRenderMd(looksLikeMarkdown(text))
    }
  }, [target])

  if (!target) return null

  const sourceText = pretty && json?.ok ? json.formatted : activeText
  const stats = cellStats(sourceText)
  const showingMd = renderMd && mdCapable
  const metaParts = [
    raw == null ? 'NULL' : json?.ok ? 'JSON' : mdCapable ? 'Markdown' : '文本',
    `${stats.chars} 字符`,
    stats.lines > 1 ? `${stats.lines} 行` : null,
    showingMd ? 'MD 预览' : null,
  ].filter(Boolean)

  const copyText = () => {
    const text = raw == null ? 'NULL' : sourceText
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleApply = () => {
    if (!onApply) return
    onApply(draft)
    onClose()
  }

  const formatDraft = () => {
    const parsed = tryFormatJson(draft)
    if (parsed.ok) setDraft(parsed.formatted)
  }

  const renderPreviewBody = () => {
    if (raw == null && !editable) return <div className="cell-viewer-null">NULL</div>
    if (showingMd) {
      if (json?.ok) {
        if (typeof json.value === 'string') {
          return (
            <div className="cell-viewer-md">
              <MarkdownPreview content={normalizeMarkdownSource(json.value)} />
            </div>
          )
        }
        return (
          <div className="cell-viewer-rich">
            <CellRichValue value={json.value} root />
          </div>
        )
      }
      return (
        <div className="cell-viewer-md">
          <MarkdownPreview content={normalizeMarkdownSource(activeText)} />
        </div>
      )
    }
    if (editable) {
      return (
        <textarea
          className={`cell-viewer-textarea ${wrap ? 'is-wrap' : 'is-nowrap'}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      )
    }
    return <pre className={`cell-viewer-pre ${wrap ? 'is-wrap' : 'is-nowrap'}`}>{sourceText}</pre>
  }

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" onClick={onClose}>
        <div
          className="wn-modal wn-modal-xl cell-viewer-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-labelledby="cell-viewer-title"
        >
          <header className="wn-modal-header-bar">
            <h2 id="cell-viewer-title" className="wn-modal-title" title={target.column}>
              {target.column}
            </h2>
            <button
              type="button"
              className="wn-modal-close-btn"
              aria-label="关闭"
              {...pressProps(onClose)}
            >
              ×
            </button>
          </header>

          <div className="cell-viewer-toolbar">
            <span className="pane-meta">{metaParts.join(' · ')}</span>
            <div className="cell-viewer-toolbar-end">
              {json?.ok && !showingMd && !editable && (
                <label className="wn-check cell-viewer-check" {...pressProps(() => setPretty((v) => !v))}>
                  <input type="checkbox" checked={pretty} readOnly tabIndex={-1} />
                  <span>格式化 JSON</span>
                </label>
              )}
              {json?.ok && editable && !showingMd && (
                <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" {...pressProps(formatDraft)}>
                  格式化
                </button>
              )}
              {mdCapable && (
                <label className="wn-check cell-viewer-check" {...pressProps(() => setRenderMd((v) => !v))}>
                  <input type="checkbox" checked={renderMd} readOnly tabIndex={-1} />
                  <span>渲染 Markdown</span>
                </label>
              )}
              {!showingMd && (
                <label className="wn-check cell-viewer-check" {...pressProps(() => setWrap((v) => !v))}>
                  <input type="checkbox" checked={wrap} readOnly tabIndex={-1} />
                  <span>自动换行</span>
                </label>
              )}
              <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" {...pressProps(copyText)}>
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>

          <div className="wn-modal-body cell-viewer-body">{renderPreviewBody()}</div>

          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-tool" {...pressProps(onClose)}>
              关闭
            </button>
            {editable && (
              <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" {...pressProps(handleApply)}>
                应用
              </button>
            )}
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

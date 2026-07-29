import { MarkdownPreview } from '../notebook/MarkdownPreview'
import { looksLikeMarkdown, normalizeMarkdownSource } from './formatCellValue'

interface Props {
  value: unknown
  /** 仅根级节点应用行间隔色。 */
  root?: boolean
}

/** CellRichValue 结构化展示 JSON，字符串字段若像 Markdown 则渲染预览。 */
export function CellRichValue({ value, root = false }: Props) {
  if (typeof value === 'string') {
    const text = normalizeMarkdownSource(value)
    if (looksLikeMarkdown(text)) {
      return (
        <div className="cell-rich-md">
          <MarkdownPreview content={text} />
        </div>
      )
    }
    return <pre className="cell-rich-string">{text}</pre>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <code className="cell-rich-scalar">{String(value)}</code>
  }
  if (value === null) {
    return <span className="grid-cell-null">null</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="cell-rich-empty">[]</span>
    }
    return (
      <div className={`cell-rich-array${root ? ' cell-rich-root' : ''}`}>
        {value.map((item, index) => (
          <div key={index} className="cell-rich-array-item">
            <span className="cell-rich-index">{index}</span>
            <div className="cell-rich-array-body">
              <CellRichValue value={item} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return <span className="cell-rich-empty">{'{}'}</span>
    }
    return (
      <div className={`cell-rich-object${root ? ' cell-rich-root' : ''}`}>
        {entries.map(([key, child]) => (
          <div key={key} className="cell-rich-field">
            <div className="cell-rich-key" title={key}>
              {key}
            </div>
            <div className="cell-rich-val">
              <CellRichValue value={child} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return <code className="cell-rich-scalar">{String(value)}</code>
}

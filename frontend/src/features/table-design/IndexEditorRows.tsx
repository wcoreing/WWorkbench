import { activeColumns, type TableColumnDraft } from './tableColumnDraft'
import type { IndexDraft } from './tableIndexDraft'
import '../../components/ui.css'

interface Props {
  indexes: IndexDraft[]
  columns: TableColumnDraft[]
  onChange: (indexes: IndexDraft[]) => void
}

/** IndexEditorRows 索引编辑列表。 */
export function IndexEditorRows({ indexes, columns, onChange }: Props) {
  const visible = indexes.filter((i) => i.status !== 'deleted')
  const colNames = activeColumns(columns).map((c) => c.name.trim())

  /** updateIdx 更新索引。 */
  const updateIdx = (id: string, patch: Partial<IndexDraft>) => {
    onChange(indexes.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  /** removeIdx 删除或标记删除索引。 */
  const removeIdx = (idx: IndexDraft) => {
    if (idx.status === 'new') {
      onChange(indexes.filter((i) => i.id !== idx.id))
      return
    }
    onChange(indexes.map((i) => (i.id === idx.id ? { ...i, status: 'deleted' } : i)))
  }

  /** parseColumnsInput 解析索引列输入。 */
  const parseColumnsInput = (text: string): string[] => {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  if (visible.length === 0) {
    return <div className="empty-hint index-empty">暂无索引（主键请在「字段」页勾选 PK）</div>
  }

  return (
    <>
      <div className="index-cols-head">
        <span>索引名</span>
        <span>列（逗号分隔，顺序即联合索引顺序）</span>
        <span>唯一</span>
        <span />
      </div>
      {visible.map((idx) => (
        <div key={idx.id} className={`index-col-row ${idx.status === 'new' ? 'col-is-new' : ''}`}>
          <input
            className="wn-input"
            value={idx.name}
            onChange={(e) => updateIdx(idx.id, { name: e.target.value })}
            placeholder="idx_name"
          />
          <input
            className="wn-input"
            value={idx.columns.join(', ')}
            onChange={(e) => updateIdx(idx.id, { columns: parseColumnsInput(e.target.value) })}
            placeholder={colNames.length ? colNames.join(', ') : 'column'}
            list={`idx-cols-${idx.id}`}
          />
          <datalist id={`idx-cols-${idx.id}`}>
            {colNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input
            type="checkbox"
            checked={idx.unique}
            onChange={(e) => updateIdx(idx.id, { unique: e.target.checked })}
            title="唯一索引"
          />
          <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => removeIdx(idx)}>
            −
          </button>
        </div>
      ))}
    </>
  )
}

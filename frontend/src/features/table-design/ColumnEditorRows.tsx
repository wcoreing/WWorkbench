import { ColumnTypePicker } from './ColumnTypePicker'
import { applyColumnPatch, type DefaultValueKind, type TableColumnDraft } from './tableColumnDraft'
import { isIntegerColumnType } from './mysqlColumnTypes'
import '../../components/ui.css'

interface Props {
  columns: TableColumnDraft[]
  onChange: (columns: TableColumnDraft[]) => void
  allowRemoveLast?: boolean
}

/** ColumnEditorRows 字段编辑行列表。 */
export function ColumnEditorRows({ columns, onChange, allowRemoveLast }: Props) {
  const visible = columns.filter((c) => c.status !== 'deleted')

  /** updateCol 更新单列。 */
  const updateCol = (id: string, patch: Partial<TableColumnDraft>) => {
    onChange(columns.map((c) => (c.id === id ? applyColumnPatch(c, patch) : c)))
  }

  /** updateColType 更新列类型。 */
  const updateColType = (
    id: string,
    patch: { typeId: string; length?: number; precision?: number; scale?: number }
  ) => {
    updateCol(id, patch)
  }

  /** removeCol 删除或标记删除列。 */
  const removeCol = (col: TableColumnDraft) => {
    if (col.status === 'new') {
      if (!allowRemoveLast && visible.length <= 1) return
      onChange(columns.filter((c) => c.id !== col.id))
      return
    }
    onChange(columns.map((c) => (c.id === col.id ? { ...c, status: 'deleted' } : c)))
  }

  return (
    <>
      <div className="create-table-cols-head">
        <span>列名</span>
        <span>类型</span>
        <span>空</span>
        <span>PK</span>
        <span>增</span>
        <span>默认值</span>
        <span>注释</span>
        <span />
      </div>
      {visible.map((col) => {
        const canAutoInc = isIntegerColumnType(col.typeId)
        const isNew = col.status === 'new'
        const defaultDisabled = col.autoIncrement
        return (
          <div key={col.id} className={`create-table-col-row ${isNew ? 'col-is-new' : ''}`}>
            <input
              className="wn-input"
              value={col.name}
              onChange={(e) => updateCol(col.id, { name: e.target.value })}
              placeholder="column_name"
            />
            <ColumnTypePicker
              typeId={col.typeId}
              length={col.length}
              precision={col.precision}
              scale={col.scale}
              onChange={(patch) => updateColType(col.id, patch)}
            />
            <input
              type="checkbox"
              checked={col.nullable}
              onChange={(e) => updateCol(col.id, { nullable: e.target.checked })}
              title="允许 NULL"
            />
            <input
              type="checkbox"
              checked={col.primaryKey}
              onChange={(e) => updateCol(col.id, { primaryKey: e.target.checked })}
              title="主键"
            />
            <input
              type="checkbox"
              checked={col.autoIncrement}
              disabled={!canAutoInc}
              onChange={(e) => updateCol(col.id, { autoIncrement: e.target.checked })}
              title={canAutoInc ? '自增' : '仅整数类型可自增'}
            />
            <div className="col-default-cell">
              <select
                className="wn-select wn-select-xs"
                value={col.defaultKind}
                disabled={defaultDisabled}
                onChange={(e) =>
                  updateCol(col.id, { defaultKind: e.target.value as DefaultValueKind })
                }
                title="默认值类型"
              >
                <option value="none">无</option>
                <option value="null">NULL</option>
                <option value="literal">字面量</option>
                <option value="current_timestamp">CURRENT_TIMESTAMP</option>
              </select>
              {col.defaultKind === 'literal' && !defaultDisabled && (
                <input
                  className="wn-input wn-input-xs"
                  value={col.defaultValue}
                  onChange={(e) => updateCol(col.id, { defaultValue: e.target.value })}
                  placeholder="默认值"
                />
              )}
            </div>
            <input
              className="wn-input"
              value={col.comment}
              onChange={(e) => updateCol(col.id, { comment: e.target.value })}
              placeholder="注释"
              title="COMMENT"
            />
            <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => removeCol(col)}>
              −
            </button>
          </div>
        )
      })}
    </>
  )
}

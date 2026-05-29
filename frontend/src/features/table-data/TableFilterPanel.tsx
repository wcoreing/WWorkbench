import type { ColumnMeta, TableFilter, TableSort } from '../../api/types'
import '../../components/ui.css'

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'like', label: '包含' },
  { value: 'not_like', label: '不包含' },
  { value: 'is_null', label: '空' },
  { value: 'is_not_null', label: '非空' },
]

interface Props {
  open: boolean
  columns: ColumnMeta[]
  filters: TableFilter[]
  sorts: TableSort[]
  dirty: boolean
  onFiltersChange: (f: TableFilter[]) => void
  onSortsChange: (s: TableSort[]) => void
  onApply: () => void
  onClear: () => void
}

/** TableFilterPanel 表数据筛选与排序面板（紧凑双栏布局）。 */
export function TableFilterPanel({
  open,
  columns,
  filters,
  sorts,
  dirty,
  onFiltersChange,
  onSortsChange,
  onApply,
  onClear,
}: Props) {
  if (!open) return null

  const addFilter = () => {
    onFiltersChange([
      ...filters,
      { enabled: true, column: columns[0]?.name ?? '', operator: 'eq', value: '' },
    ])
  }

  const updateFilter = (idx: number, patch: Partial<TableFilter>) => {
    onFiltersChange(filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  const removeFilter = (idx: number) => {
    if (filters.length <= 1) {
      onFiltersChange([{ enabled: true, column: columns[0]?.name ?? '', operator: 'eq', value: '' }])
      return
    }
    onFiltersChange(filters.filter((_, i) => i !== idx))
  }

  const addSort = () => {
    onSortsChange([...sorts, { column: columns[0]?.name ?? '', ascending: true }])
  }

  const updateSort = (idx: number, patch: Partial<TableSort>) => {
    onSortsChange(sorts.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const removeSort = (idx: number) => {
    onSortsChange(sorts.filter((_, i) => i !== idx))
  }

  const valueDisabled = (op: string) => op === 'is_null' || op === 'is_not_null'

  return (
    <div className="filter-panel">
      <div className="filter-panel-body">
        <section className="filter-panel-col">
          <div className="filter-panel-head">
            <span className="filter-panel-label">WHERE</span>
            <button type="button" className="wn-btn wn-btn-tool filter-panel-add" onClick={addFilter} title="添加条件">
              +
            </button>
          </div>
          <div className="filter-lines">
            {filters.map((f, idx) => (
              <div key={idx} className="filter-line">
                {idx > 0 ? <span className="filter-join">AND</span> : <span className="filter-join filter-join-empty" />}
                <label className="filter-check" title="启用">
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={(e) => updateFilter(idx, { enabled: e.target.checked })}
                  />
                </label>
                <select
                  className="wn-select"
                  value={f.column}
                  onChange={(e) => updateFilter(idx, { column: e.target.value })}
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="wn-select filter-op-select"
                  value={f.operator}
                  onChange={(e) => updateFilter(idx, { operator: e.target.value })}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  className="wn-input"
                  value={f.value}
                  disabled={valueDisabled(f.operator)}
                  placeholder={valueDisabled(f.operator) ? '—' : '值'}
                  onChange={(e) => updateFilter(idx, { value: e.target.value })}
                />
                <button
                  type="button"
                  className="wn-btn wn-btn-tool wn-btn-icon-only filter-line-del"
                  onClick={() => removeFilter(idx)}
                  title="删除条件"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="filter-panel-col">
          <div className="filter-panel-head">
            <span className="filter-panel-label">ORDER BY</span>
            <button type="button" className="wn-btn wn-btn-tool filter-panel-add" onClick={addSort} title="添加排序">
              +
            </button>
          </div>
          <div className="filter-lines">
            {sorts.length === 0 ? (
              <div className="filter-line filter-line-placeholder">—</div>
            ) : (
              sorts.map((s, idx) => (
                <div key={idx} className="filter-line">
                  <span className="filter-join filter-join-empty" />
                  <span className="filter-check filter-check-spacer" />
                  <select
                    className="wn-select"
                    value={s.column}
                    onChange={(e) => updateSort(idx, { column: e.target.value })}
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="wn-select filter-op-select"
                    value={s.ascending ? 'asc' : 'desc'}
                    onChange={(e) => updateSort(idx, { ascending: e.target.value === 'asc' })}
                  >
                    <option value="asc">ASC</option>
                    <option value="desc">DESC</option>
                  </select>
                  <span className="filter-line-fill" />
                  <button
                    type="button"
                    className="wn-btn wn-btn-tool wn-btn-icon-only filter-line-del"
                    onClick={() => removeSort(idx)}
                    title="删除排序"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="filter-panel-foot">
        {dirty && <span className="filter-dirty">有未应用的更改</span>}
        <span className="filter-panel-foot-spacer" />
        <button type="button" className="wn-btn wn-btn-tool" onClick={onClear}>
          重置
        </button>
        <button type="button" className="wn-btn wn-btn-tool wn-btn-accent" onClick={onApply}>
          应用
        </button>
      </div>
    </div>
  )
}

/** defaultFilters 返回默认空筛选条件。 */
export function defaultFilters(): TableFilter[] {
  return [{ enabled: true, column: '', operator: 'eq', value: '' }]
}

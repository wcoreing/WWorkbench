import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { ColumnMeta, FieldValue, RowMutationBatch, TableDataPage, TableFilter, TableRow, TableSort } from '../../api/types'
import { TableFilterPanel, defaultFilters } from './TableFilterPanel'
import '../../components/ui.css'

type RowState = 'clean' | 'modified' | 'new' | 'deleted'

interface EditableRow extends TableRow {
  state: RowState
  editValues: Record<string, string | null>
  oldPk?: Record<string, string | null>
}

interface Props {
  sessionId: string
  database: string
  table: string
}

const PAGE_SIZE = 100

export function TableDataEditor({ sessionId, database, table }: Props) {
  const [page, setPage] = useState<TableDataPage | null>(null)
  const [rows, setRows] = useState<EditableRow[]>([])
  const [pageNum, setPageNum] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<TableFilter[]>(defaultFilters())
  const [sorts, setSorts] = useState<TableSort[]>([])
  const [appliedFilters, setAppliedFilters] = useState<TableFilter[]>([])
  const [appliedSorts, setAppliedSorts] = useState<TableSort[]>([])
  const [filterDirty, setFilterDirty] = useState(false)

  const columns = page?.columns ?? []

  useEffect(() => {
    if (columns.length && filters.length === 1 && !filters[0].column) {
      setFilters([{ enabled: true, column: columns[0].name, operator: 'eq', value: '' }])
    }
  }, [columns.length])

  useEffect(() => {
    const fChanged = JSON.stringify(filters) !== JSON.stringify(appliedFilters)
    const sChanged = JSON.stringify(sorts) !== JSON.stringify(appliedSorts)
    setFilterDirty(fChanged || sChanged)
  }, [filters, sorts, appliedFilters, appliedSorts])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const data = await api.getTableDataPage(sessionId, database, table, {
        page: pageNum,
        pageSize: PAGE_SIZE,
        filters: appliedFilters.filter((f) => f.enabled && f.column),
        sorts: appliedSorts.filter((s) => s.column),
      })
      setPage(data)
      setRows(
        data.rows.map((r) => ({
          ...r,
          state: 'clean' as RowState,
          editValues: rowToEdit(r, data.columns),
        }))
      )
    } catch (e) {
      setPage(null)
      setRows([])
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId, database, table, pageNum, appliedFilters, appliedSorts])

  useEffect(() => {
    setPageNum(1)
    setAppliedFilters([])
    setAppliedSorts([])
    setFilters(defaultFilters())
    setSorts([])
    setFilterOpen(false)
  }, [sessionId, database, table])

  useEffect(() => {
    load()
  }, [load])

  const activeFilterCount = useMemo(
    () => appliedFilters.filter((f) => f.enabled && f.column).length,
    [appliedFilters]
  )

  const applyFilter = () => {
    setAppliedFilters(filters.map((f) => ({ ...f })))
    setAppliedSorts(sorts.map((s) => ({ ...s })))
    setPageNum(1)
    setFilterDirty(false)
  }

  const clearFilter = () => {
    const empty = columns[0]
      ? [{ enabled: true, column: columns[0].name, operator: 'eq', value: '' }]
      : defaultFilters()
    setFilters(empty)
    setSorts([])
    setAppliedFilters([])
    setAppliedSorts([])
    setPageNum(1)
    setFilterDirty(false)
  }

  const updateCell = (rowId: string, col: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const nullable = columns.find((c) => c.name === col)?.nullable
        const editValues = {
          ...r.editValues,
          [col]: value === '' && nullable ? null : value,
        }
        const state: RowState = r.state === 'new' ? 'new' : 'modified'
        const oldPk = r.oldPk || pkFromRow(r, columns)
        return { ...r, editValues, state, oldPk }
      })
    )
  }

  const addRow = () => {
    if (!page || page.readOnly) return
    const editValues: Record<string, string | null> = {}
    columns.forEach((c) => {
      editValues[c.name] = c.defaultValue ?? (c.nullable ? null : '')
    })
    setRows((prev) => [
      ...prev,
      { rowId: `new-${Date.now()}`, values: {}, state: 'new', editValues },
    ])
  }

  const deleteRow = (rowId: string) => {
    setRows((prev) =>
      prev
        .map((r) => {
          if (r.rowId !== rowId) return r
          if (r.state === 'new') return null
          return { ...r, state: 'deleted' as RowState, oldPk: r.oldPk || pkFromRow(r, columns) }
        })
        .filter(Boolean) as EditableRow[]
    )
  }

  const commit = async () => {
    if (!page || page.readOnly) return
    const batch: RowMutationBatch = { inserts: [], updates: [], deletes: [] }
    for (const r of rows) {
      if (r.state === 'new') {
        batch.inserts.push({ rowId: r.rowId, fields: toFields(r.editValues) })
      } else if (r.state === 'modified') {
        batch.updates.push({
          rowId: r.rowId,
          fields: toFields(r.editValues),
          oldPk: toFields(r.oldPk || pkFromRow(r, columns)),
        })
      } else if (r.state === 'deleted') {
        batch.deletes.push({
          rowId: r.rowId,
          fields: toFields(r.editValues),
          oldPk: toFields(r.oldPk || pkFromRow(r, columns)),
        })
      }
    }
    if (!batch.inserts.length && !batch.updates.length && !batch.deletes.length) {
      setError('没有待提交的变更')
      return
    }
    setError('')
    try {
      await api.applyTableMutations(sessionId, database, table, batch as never)
      setSuccess('保存成功')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading && !page) {
    return <div className="pane-loading">加载表数据…</div>
  }

  if (error && !page) {
    return (
      <div className="pane-loading">
        <div className="wn-form-msg error">{error}</div>
        <button type="button" className="wn-btn wn-btn-tool" onClick={load}>
          重试
        </button>
      </div>
    )
  }

  if (!page) {
    return <div className="pane-loading">暂无数据</div>
  }

  const rowCount = page.rows?.length ?? 0
  const metaParts = [
    `第 ${page.page} 页`,
    page.total >= 0 ? `共 ${page.total} 行` : null,
    activeFilterCount > 0 ? `筛选 ${activeFilterCount}` : null,
    page.readOnly ? '只读' : null,
    loading ? '加载中' : null,
  ].filter(Boolean)

  return (
    <div className="table-workspace">
      <div className="pane-head">
        <div className="pane-toolbar">
          <div className="pane-toolbar-start">
            <span className="pane-title">
              {database}.{table}
            </span>
            <span className="pane-meta">{metaParts.join(' · ')}</span>
          </div>
          <div className="pane-toolbar-end">
            <button
              type="button"
              className={`wn-btn wn-btn-tool ${filterOpen ? 'active' : ''}`}
              onClick={() => setFilterOpen((v) => !v)}
              title="筛选与排序"
            >
              筛选
              {filterDirty && <span className="badge-dot" />}
              {activeFilterCount > 0 && !filterDirty && (
                <span className="badge-count">{activeFilterCount}</span>
              )}
            </button>
            <span className="pane-vrule" />
            {!page.readOnly && (
              <>
                <button type="button" className="wn-btn wn-btn-tool" onClick={addRow}>
                  新增
                </button>
                <button type="button" className="wn-btn wn-btn-tool wn-btn-accent" onClick={commit}>
                  提交
                </button>
                <span className="pane-vrule" />
              </>
            )}
            <button
              type="button"
              className="wn-btn wn-btn-tool"
              disabled={pageNum <= 1 || loading}
              onClick={() => setPageNum((p) => p - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-tool"
              disabled={rowCount < PAGE_SIZE || loading}
              onClick={() => setPageNum((p) => p + 1)}
            >
              下一页
            </button>
            <button type="button" className="wn-btn wn-btn-tool" onClick={load} disabled={loading}>
              刷新
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-tool"
              disabled={loading}
              onClick={async () => {
                const path = await api.exportTableInsertSQL(sessionId, database, table, 1000)
                if (path) setSuccess(`已导出 ${path}`)
              }}
            >
              导出 SQL
            </button>
          </div>
        </div>

        <TableFilterPanel
          open={filterOpen}
          columns={columns}
          filters={filters}
          sorts={sorts}
          dirty={filterDirty}
          onFiltersChange={setFilters}
          onSortsChange={setSorts}
          onApply={applyFilter}
          onClear={clearFilter}
        />
      </div>

      {(error || success) && (
        <div className="pane-flash">
          {error && <div className="wn-form-msg error">{error}</div>}
          {success && <div className="wn-form-msg success">{success}</div>}
        </div>
      )}

      <div className="wn-grid-wrap">
        <table className="wn-grid">
          <thead>
            <tr>
              <th className="col-index">#</th>
              {columns.map((c) => (
                <th key={c.name} title={c.name}>
                  <span className="col-head-label">{c.name}</span>
                  {c.isPrimaryKey && <span className="col-pk" title="主键" />}
                </th>
              ))}
              {!page.readOnly && <th className="col-actions">操作</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (page.readOnly ? 1 : 2)} className="grid-empty">
                  {activeFilterCount > 0 ? '无匹配数据' : '（空表）'}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.rowId} className={`row-${r.state}`}>
                  <td className="col-index">{idx + 1}</td>
                  {columns.map((c) => (
                    <td key={c.name}>
                      {page.readOnly || !c.editable || r.state === 'deleted' ? (
                        <CellDisplay row={r} col={c} />
                      ) : (
                        <input
                          className="grid-cell-input"
                          value={r.editValues[c.name] ?? ''}
                          onChange={(e) => updateCell(r.rowId, c.name, e.target.value)}
                          placeholder={c.nullable ? 'NULL' : ''}
                        />
                      )}
                    </td>
                  ))}
                  {!page.readOnly && (
                    <td className="col-actions">
                      <button type="button" className="wn-btn-text wn-btn-text-danger" onClick={() => deleteRow(r.rowId)}>
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** CellDisplay 只读单元格展示。 */
function CellDisplay({ row, col }: { row: EditableRow; col: ColumnMeta }) {
  const cell = row.values?.[col.name]
  if (!cell || cell.isNull) {
    return <span className="grid-cell-null">NULL</span>
  }
  const text = cell.display ?? cell.value ?? ''
  return <span className="grid-cell-value">{text}</span>
}

function rowToEdit(row: TableRow, cols: ColumnMeta[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const c of cols) {
    const cell = row.values?.[c.name]
    if (!cell || cell.isNull) out[c.name] = null
    else out[c.name] = cell.value ?? cell.display ?? ''
  }
  return out
}

function pkFromRow(row: EditableRow | TableRow, cols: ColumnMeta[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const c of cols) {
    if (!c.isPrimaryKey) continue
    const cell = row.values?.[c.name]
    if (!cell || cell.isNull) out[c.name] = null
    else out[c.name] = cell.value ?? cell.display ?? ''
  }
  return out
}

function toFields(values: Record<string, string | null>): FieldValue[] {
  return Object.entries(values).map(([name, value]) => ({
    name,
    value: value ?? undefined,
    isNull: value === null,
  }))
}

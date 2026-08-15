import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { ColumnMeta, FieldValue, RowMutationBatch, TableDataPage, TableFilter, TableRow, TableSort } from '../../api/types'
import { TableFilterPanel, defaultFilters } from './TableFilterPanel'
import { ExportFieldsDialog } from '../export/ExportFieldsDialog'
import { CellViewerDialog, type CellViewerTarget } from '../cell-viewer/CellViewerDialog'
import { isLikelyLargeCell } from '../cell-viewer/formatCellValue'
import { pressProps } from '../../components/compat'
import {
  ACTIONS_COL_WIDTH,
  INDEX_COL_WIDTH,
  ResizableTh,
  WnGrid,
  dataColParts,
  useColumnWidths,
} from '../grid/columnResize'
import { isInvalidSortColumn, isTableMissing } from '../../api/errors'
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
  excelExport?: boolean
  /** 表已不存在时回调（由工作台关闭 Tab）。 */
  onTableMissing?: () => void
}

const PAGE_SIZE = 100

export function TableDataEditor({ sessionId, database, table, excelExport, onTableMissing }: Props) {
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
  const [excelExportOpen, setExcelExportOpen] = useState(false)
  const [viewer, setViewer] = useState<(CellViewerTarget & { rowId: string }) | null>(null)
  const loadSeq = useRef(0)
  const onTableMissingRef = useRef(onTableMissing)
  onTableMissingRef.current = onTableMissing
  const { colStyle, tableStyle, onResizeStart } = useColumnWidths()

  const columns = page?.columns ?? []
  const columnNames = columns.map((c) => c.name)
  const firstColName = columns[0]?.name ?? ''
  const gridColParts = [
    { key: '__index', fallback: INDEX_COL_WIDTH },
    ...dataColParts(columnNames),
    ...(!page?.readOnly ? [{ key: '__actions', fallback: ACTIONS_COL_WIDTH }] : []),
  ]
  const queryFilters = useMemo(
    () => appliedFilters.filter((f) => f.enabled && f.column),
    [appliedFilters],
  )
  const querySorts = useMemo(() => appliedSorts.filter((s) => s.column), [appliedSorts])

  useEffect(() => {
    if (!firstColName) return
    setFilters((prev) =>
      prev.length === 1 && !prev[0].column
        ? [{ enabled: true, column: firstColName, operator: 'eq', value: '' }]
        : prev,
    )
  }, [firstColName])

  useEffect(() => {
    const fChanged = JSON.stringify(filters) !== JSON.stringify(appliedFilters)
    const sChanged = JSON.stringify(sorts) !== JSON.stringify(appliedSorts)
    setFilterDirty(fChanged || sChanged)
  }, [filters, sorts, appliedFilters, appliedSorts])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const data = await api.getTableDataPage(sessionId, database, table, {
        page: pageNum,
        pageSize: PAGE_SIZE,
        filters: queryFilters,
        sorts: querySorts,
      })
      if (seq !== loadSeq.current) return
      setPage(data)
      setRows(
        data.rows.map((r) => ({
          ...r,
          state: 'clean' as RowState,
          editValues: rowToEdit(r, data.columns),
        }))
      )
    } catch (e) {
      if (seq !== loadSeq.current) return
      if (isTableMissing(e)) {
        onTableMissingRef.current?.()
        return
      }
      setError(e instanceof Error ? e.message : String(e))
      if (isInvalidSortColumn(e) && querySorts.length > 0) {
        setSorts([])
        setAppliedSorts([])
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [sessionId, database, table, pageNum, queryFilters, querySorts])

  useEffect(() => {
    load()
  }, [load])

  const activeFilterCount = queryFilters.length
  const activeSortCount = querySorts.length

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

  /** applySortsNow 立即应用排序并回到第一页（表头点击）。 */
  const applySortsNow = (next: TableSort[]) => {
    setSorts(next)
    setAppliedSorts(next)
    setPageNum(1)
  }

  /**
   * toggleColumnSort 表头排序：单击切换 升序→降序→取消；
   * Shift+单击在多列排序中追加/切换/移除该列。
   */
  const toggleColumnSort = (column: string, multi: boolean) => {
    if (!column || !columns.some((c) => c.name === column)) return
    const current = appliedSorts.filter((s) => s.column)
    const idx = current.findIndex((s) => s.column === column)
    if (multi) {
      if (idx < 0) {
        applySortsNow([...current, { column, ascending: true }])
        return
      }
      if (current[idx].ascending) {
        applySortsNow(current.map((s, i) => (i === idx ? { ...s, ascending: false } : s)))
        return
      }
      applySortsNow(current.filter((_, i) => i !== idx))
      return
    }
    if (idx === 0 && current.length === 1) {
      applySortsNow(current[0].ascending ? [{ column, ascending: false }] : [])
      return
    }
    applySortsNow([{ column, ascending: true }])
  }

  const sortIndexOf = (column: string) => appliedSorts.findIndex((s) => s.column === column)

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
    activeSortCount > 0 ? `排序 ${activeSortCount}` : null,
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
              {(activeFilterCount > 0 || activeSortCount > 0) && !filterDirty && (
                <span className="badge-count">{activeFilterCount + activeSortCount}</span>
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
            <button type="button" className="wn-btn wn-btn-tool" {...pressProps(load, { disabled: loading })} disabled={loading}>
              刷新
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-tool"
              disabled={loading}
              {...pressProps(
                () => {
                  void (async () => {
                    const path = await api.exportTableInsertSQL(sessionId, database, table, 1000)
                    if (path) setSuccess(`已导出 ${path}`)
                  })()
                },
                { disabled: loading },
              )}
            >
              导出 SQL
            </button>
            {excelExport && (
              <button
                type="button"
                className="wn-btn wn-btn-tool wn-btn-accent"
                disabled={loading || columnNames.length === 0}
                {...pressProps(() => setExcelExportOpen(true), {
                  disabled: loading || columnNames.length === 0,
                })}
              >
                导出 Excel
              </button>
            )}
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

      <WnGrid
        parts={gridColParts}
        colStyle={colStyle}
        tableStyle={tableStyle}
        header={
          <>
            <th className="col-index">#</th>
            {columns.map((c) => {
              const sortIdx = sortIndexOf(c.name)
              const sort = sortIdx >= 0 ? appliedSorts[sortIdx] : null
              const sortClass = sort ? ` is-sorted is-${sort.ascending ? 'asc' : 'desc'}` : ''
              return (
                <ResizableTh
                  key={c.name}
                  colKey={c.name}
                  className={`col-sortable${sortClass}`}
                  title={`${c.name}（点击排序，Shift+点击多列）`}
                  onClick={(e) => toggleColumnSort(c.name, e.shiftKey)}
                  onResizeStart={onResizeStart}
                >
                  <span className="col-head-label">{c.name}</span>
                  {c.isPrimaryKey && <span className="col-pk" title="主键" />}
                  {sort && (
                    <span className="col-sort-ind" aria-hidden>
                      {sort.ascending ? '↑' : '↓'}
                      {activeSortCount > 1 ? sortIdx + 1 : ''}
                    </span>
                  )}
                </ResizableTh>
              )
            })}
            {!page.readOnly && <th className="col-actions">操作</th>}
          </>
        }
      >
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
              {columns.map((c) => {
                const cell = r.values?.[c.name]
                const display = cell?.isNull ? null : (r.editValues[c.name] ?? cell?.display ?? cell?.value ?? '')
                const large = isLikelyLargeCell(display)
                const readOnly = page.readOnly || !c.editable || r.state === 'deleted'
                return (
                  <td
                    key={c.name}
                    className={large ? 'grid-cell-expandable' : undefined}
                    title={large ? '双击查看完整内容' : undefined}
                    onDoubleClick={() =>
                      setViewer({
                        rowId: r.rowId,
                        column: c.name,
                        value: display,
                        isNull: display === null,
                        editable: !readOnly,
                      })
                    }
                  >
                    {readOnly ? (
                      <CellDisplay row={r} col={c} />
                    ) : (
                      <div className="grid-cell-edit">
                        <input
                          className="grid-cell-input"
                          value={r.editValues[c.name] ?? ''}
                          onChange={(e) => updateCell(r.rowId, c.name, e.target.value)}
                          placeholder={c.nullable ? 'NULL' : ''}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setViewer({
                              rowId: r.rowId,
                              column: c.name,
                              value: display,
                              isNull: display === null,
                              editable: true,
                            })
                          }}
                        />
                        {large && (
                          <button
                            type="button"
                            className="grid-cell-expand"
                            title="查看完整内容"
                            onClick={(e) => {
                              e.stopPropagation()
                              setViewer({
                                rowId: r.rowId,
                                column: c.name,
                                value: display,
                                isNull: display === null,
                                editable: true,
                              })
                            }}
                          >
                            ↗
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )
              })}
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
      </WnGrid>
      <ExportFieldsDialog
        open={excelExportOpen}
        columns={columnNames}
        onConfirm={async (cols) => {
          setExcelExportOpen(false)
          const path = await api.exportTableExcel(
            sessionId,
            database,
            table,
            {
              page: pageNum,
              pageSize: PAGE_SIZE,
              filters: queryFilters,
              sorts: querySorts,
            },
            cols
          )
          if (path) setSuccess(`已导出 ${path}`)
        }}
        onCancel={() => setExcelExportOpen(false)}
      />
      <CellViewerDialog
        target={viewer}
        onClose={() => setViewer(null)}
        onApply={
          viewer?.editable
            ? (value) => {
                updateCell(viewer.rowId, viewer.column, value ?? '')
              }
            : undefined
        }
      />
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
  return (
    <span className={`grid-cell-value ${isLikelyLargeCell(text) ? 'is-large' : ''}`} title={text.length > 80 ? undefined : text}>
      {text}
    </span>
  )
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

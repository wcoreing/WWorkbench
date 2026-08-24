import { useState } from 'react'
import type { CellValue, ExecuteResult, QueryPage, SQLBatchResult } from '../../api/types'
import { ExportFieldsDialog } from '../export/ExportFieldsDialog'
import { CellViewerDialog, type CellViewerTarget } from '../cell-viewer/CellViewerDialog'
import { isLikelyLargeCell } from '../cell-viewer/formatCellValue'
import { ResizableTh, WnGrid, dataColParts, useColumnWidths } from '../grid/columnResize'
import { LoadingPane } from '../../components/LoadingHost'
import '../../components/ui.css'
import { pressProps } from '../../components/compat'

interface Props {
  result: QueryPage | ExecuteResult | SQLBatchResult | null
  message: string
  onExport?: (columns: string[]) => void | Promise<void>
  onExportExcel?: (columns: string[]) => void | Promise<void>
  onPageChange?: (page: number) => void
  loadingKey?: string
  loading?: boolean
}

/** isBatchResult 判断是否为多语句批量结果。 */
function isBatchResult(r: QueryPage | ExecuteResult | SQLBatchResult): r is SQLBatchResult {
  return 'items' in r && Array.isArray((r as SQLBatchResult).items)
}

export function ResultPanel({ result, message, onExport, onExportExcel, onPageChange, loadingKey, loading }: Props) {
  const body = !result ? (
    <div className="pane-empty">{message || '执行 SQL 后在此显示结果'}</div>
  ) : isBatchResult(result) ? (
    <div className="result-batch">
      {result.items.map((item, i) => (
        <div key={i} className="result-batch-item">
          <div className="result-batch-head">
            <span className="pane-meta">语句 {i + 1}</span>
            <code className="result-batch-sql">{item.sql}</code>
          </div>
          {item.error ? (
            <div className="pane-empty result-batch-error">{item.error}</div>
          ) : item.query ? (
            <QueryResultView page={item.query} onExport={undefined} onPageChange={undefined} loading={false} />
          ) : item.execute ? (
            <ExecuteResultView result={item.execute} />
          ) : null}
        </div>
      ))}
    </div>
  ) : 'rowsAffected' in result ? (
    <ExecuteResultView result={result} />
  ) : (
    <QueryResultView
      page={result as QueryPage}
      onExport={onExport}
      onExportExcel={onExportExcel}
      onPageChange={onPageChange}
      loading={loading}
    />
  )

  if (loadingKey) {
    return (
      <LoadingPane loadingKey={loadingKey} label="加载中…" minHeight={120}>
        {body}
      </LoadingPane>
    )
  }

  return body
}

function ExecuteResultView({ result }: { result: ExecuteResult }) {
  return (
    <div className="result-workspace">
      <div className="pane-toolbar">
        <div className="pane-toolbar-start">
          <span className="pane-meta">{result.message}</span>
        </div>
        <div className="pane-toolbar-end">
          <span className="pane-meta">影响 {result.rowsAffected} 行</span>
          <span className="pane-meta">{result.elapsedMs} ms</span>
        </div>
      </div>
    </div>
  )
}

function QueryResultView({
  page,
  onExport,
  onExportExcel,
  onPageChange,
  loading,
}: {
  page: QueryPage
  onExport?: (columns: string[]) => void | Promise<void>
  onExportExcel?: (columns: string[]) => void | Promise<void>
  onPageChange?: (page: number) => void
  loading?: boolean
}) {
  const [exportDlg, setExportDlg] = useState<'csv' | 'excel' | null>(null)
  const [viewer, setViewer] = useState<CellViewerTarget | null>(null)
  const { colStyle, tableStyle, onResizeStart } = useColumnWidths()
  const columnNames = (page.columns ?? []).map((c) => c.name)
  const gridColParts = dataColParts(columnNames)
  const rowLen = (page.rows ?? []).length
  const totalPages = page.pageSize > 0 ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1
  const canPrev = page.page > 1
  const canNext = page.page < totalPages

  return (
    <div className="result-workspace">
      <div className="pane-toolbar">
        <div className="pane-toolbar-start">
          <span className="pane-meta">
            {rowLen} 行 · 总计 {page.total} · 第 {page.page}/{totalPages} 页 · {page.elapsedMs} ms
          </span>
        </div>
        <div className="pane-toolbar-end">
          {onPageChange && (
            <>
              <button
                type="button"
                className="wn-btn wn-btn-tool"
                disabled={!canPrev || loading}
                onClick={() => onPageChange(page.page - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-tool"
                disabled={!canNext || loading}
                onClick={() => onPageChange(page.page + 1)}
              >
                下一页
              </button>
            </>
          )}
          {onExportExcel && (
            <button type="button" className="wn-btn wn-btn-tool wn-btn-accent" {...pressProps(() => setExportDlg('excel'))}>
              导出 Excel
            </button>
          )}
          {onExport && (
            <button type="button" className="wn-btn wn-btn-tool" {...pressProps(() => setExportDlg('csv'))}>
              导出 CSV
            </button>
          )}
        </div>
      </div>
      <ExportFieldsDialog
        open={exportDlg !== null}
        columns={columnNames}
        onConfirm={(cols) => {
          const fmt = exportDlg
          setExportDlg(null)
          if (fmt === 'excel') onExportExcel?.(cols)
          else if (fmt === 'csv') onExport?.(cols)
        }}
        onCancel={() => setExportDlg(null)}
      />
      <WnGrid
        parts={gridColParts}
        colStyle={colStyle}
        tableStyle={tableStyle}
        header={
          <>
            {(page.columns ?? []).map((c) => (
              <ResizableTh key={c.name} colKey={c.name} title={c.name} onResizeStart={onResizeStart}>
                <span className="col-head-label">{c.name}</span>
              </ResizableTh>
            ))}
          </>
        }
      >
        {(page.rows ?? []).map((row, i) => (
          <tr key={i}>
            {(row.cells ?? []).map((cell, j) => {
              const colName = page.columns?.[j]?.name ?? `col${j}`
              const text = cell.isNull ? null : (cell.display ?? cell.value ?? '')
              const large = isLikelyLargeCell(text)
              return (
                <td
                  key={j}
                  className={large ? 'grid-cell-expandable' : undefined}
                  title={large ? '双击查看完整内容' : undefined}
                  onDoubleClick={() =>
                    setViewer({
                      column: colName,
                      value: text,
                      isNull: cell.isNull,
                    })
                  }
                >
                  <CellValueView cell={cell} large={large} />
                </td>
              )
            })}
          </tr>
        ))}
      </WnGrid>
      <CellViewerDialog target={viewer} onClose={() => setViewer(null)} />
    </div>
  )
}

function CellValueView({ cell, large }: { cell: CellValue; large?: boolean }) {
  if (cell.isNull) return <span className="grid-cell-null">NULL</span>
  return (
    <span className={`grid-cell-value ${large ? 'is-large' : ''}`}>
      {cell.display ?? cell.value ?? ''}
    </span>
  )
}

import { useState } from 'react'
import type { CellValue, ExecuteResult, QueryPage, SQLBatchResult } from '../../api/types'
import { ExportFieldsDialog } from '../export/ExportFieldsDialog'
import '../../components/ui.css'

interface Props {
  result: QueryPage | ExecuteResult | SQLBatchResult | null
  message: string
  onExport?: (columns: string[]) => void | Promise<void>
  onExportExcel?: (columns: string[]) => void | Promise<void>
  onPageChange?: (page: number) => void
  loading?: boolean
}

/** isBatchResult 判断是否为多语句批量结果。 */
function isBatchResult(r: QueryPage | ExecuteResult | SQLBatchResult): r is SQLBatchResult {
  return 'items' in r && Array.isArray((r as SQLBatchResult).items)
}

export function ResultPanel({ result, message, onExport, onExportExcel, onPageChange, loading }: Props) {
  if (!result) {
    return <div className="pane-empty">{message || '执行 SQL 后在此显示结果'}</div>
  }

  if (isBatchResult(result)) {
    return (
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
    )
  }

  if ('rowsAffected' in result) {
    return <ExecuteResultView result={result} />
  }

  return (
    <QueryResultView
      page={result as QueryPage}
      onExport={onExport}
      onExportExcel={onExportExcel}
      onPageChange={onPageChange}
      loading={loading}
    />
  )
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
  const columnNames = (page.columns ?? []).map((c) => c.name)
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
            {loading ? ' · 加载中…' : ''}
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
            <button type="button" className="wn-btn wn-btn-tool wn-btn-accent" onClick={() => setExportDlg('excel')}>
              导出 Excel
            </button>
          )}
          {onExport && (
            <button type="button" className="wn-btn wn-btn-tool" onClick={() => setExportDlg('csv')}>
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
      <div className="wn-grid-wrap">
        <table className="wn-grid">
          <thead>
            <tr>
              {(page.columns ?? []).map((c) => (
                <th key={c.name} title={c.name}>
                  <span className="col-head-label">{c.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(page.rows ?? []).map((row, i) => (
              <tr key={i}>
                {(row.cells ?? []).map((cell, j) => (
                  <td key={j}>
                    <CellValueView cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CellValueView({ cell }: { cell: CellValue }) {
  if (cell.isNull) return <span className="grid-cell-null">NULL</span>
  return <span className="grid-cell-value">{cell.display ?? cell.value ?? ''}</span>
}

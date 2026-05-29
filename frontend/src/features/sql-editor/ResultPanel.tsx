import type { CellValue, ExecuteResult, QueryPage } from '../../api/types'
import '../../components/ui.css'

interface Props {
  result: QueryPage | ExecuteResult | null
  message: string
  onExport?: () => void
}

export function ResultPanel({ result, message, onExport }: Props) {
  if (!result) {
    return <div className="pane-empty">{message || '执行 SQL 后在此显示结果'}</div>
  }

  if ('rowsAffected' in result) {
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

  const page = result as QueryPage
  const rowLen = (page.rows ?? []).length

  return (
    <div className="result-workspace">
      <div className="pane-toolbar">
        <div className="pane-toolbar-start">
          <span className="pane-meta">
            {rowLen} 行 · 总计 {page.total} · {page.elapsedMs} ms
          </span>
        </div>
        {onExport && (
          <div className="pane-toolbar-end">
            <button type="button" className="wn-btn wn-btn-tool wn-btn-accent" onClick={onExport}>
              导出 CSV
            </button>
          </div>
        )}
      </div>
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

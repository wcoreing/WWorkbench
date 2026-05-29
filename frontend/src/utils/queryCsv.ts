import type { ColumnMeta, QueryPage } from '../api/types'

/** queryPageToCSV 将查询结果转为 CSV 表头与行数据。 */
export function queryPageToCSV(page: QueryPage): { headers: string[]; rows: string[][] } {
  const columns = page.columns ?? []
  const rows = page.rows ?? []
  const headers = columns.map((c: ColumnMeta) => c.name)
  const data = rows.map((row) =>
    (row.cells ?? []).map((cell) => (cell.isNull ? '' : cell.display ?? cell.value ?? ''))
  )
  return { headers, rows: data }
}

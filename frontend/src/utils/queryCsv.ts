import type { ColumnMeta, QueryPage } from '../api/types'

/** queryPageToExport 将查询结果转为导出行，可按字段名筛选。 */
export function queryPageToExport(page: QueryPage, columnNames?: string[]): { headers: string[]; rows: string[][] } {
  const allColumns = page.columns ?? []
  const selected =
    columnNames && columnNames.length > 0
      ? columnNames.filter((name) => allColumns.some((c) => c.name === name))
      : allColumns.map((c: ColumnMeta) => c.name)
  const colIndexes = selected.map((name) => allColumns.findIndex((c) => c.name === name))
  const headers = selected
  const data = (page.rows ?? []).map((row) =>
    colIndexes.map((i) => {
      const cell = row.cells?.[i]
      if (!cell || cell.isNull) return ''
      return cell.display ?? cell.value ?? ''
    })
  )
  return { headers, rows: data }
}

/** queryPageToCSV 将查询结果转为 CSV 表头与行数据（全部字段）。 */
export function queryPageToCSV(page: QueryPage): { headers: string[]; rows: string[][] } {
  return queryPageToExport(page)
}

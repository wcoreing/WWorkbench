/** localizeWorkTabTitle 将已知工作区标签标题转为当前语言。 */
export function localizeWorkTabTitle(
  title: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (
    title === '无标题查询' ||
    title === '无标题 - 查询' ||
    title === 'Untitled query' ||
    title === 'Untitled - Query'
  ) {
    return t('database.untitledQuery')
  }
  if (title === '历史查询' || title === 'History query') return t('database.historyQuery')
  if (title === '笔记本' || title === 'Notebook') return t('database.notebookTab')

  let m = title.match(/^(?:新建表|New table) · (.+)$/i)
  if (m) return t('database.newTableTab', { database: m[1] })

  m = title.match(/^(?:设计|Design) · (.+)$/i)
  if (m) return t('database.designTab', { table: m[1] })

  m = title.match(/^(?:索引|Index) · (.+)$/i)
  if (m) return t('database.indexTab', { table: m[1] })

  return title
}

/** defaultUntitledSql 默认 SQL 标签初始内容。 */
export function defaultUntitledSql() {
  return '-- SQL\nSELECT 1;\n'
}

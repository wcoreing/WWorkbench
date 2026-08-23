/** isMysqlSystemDatabase 判断 MySQL 系统库。 */
export function isMysqlSystemDatabase(name: string): boolean {
  switch (name.toLowerCase()) {
    case 'mysql':
    case 'information_schema':
    case 'performance_schema':
    case 'sys':
      return true
    default:
      return false
  }
}

/** isProtectedDatabase 禁止删除的系统库（按引擎）。 */
export function isProtectedDatabase(name: string, dbType?: string): boolean {
  const n = name.toLowerCase()
  if (dbType === 'postgresql') {
    return n === 'postgres' || n === 'template0' || n === 'template1'
  }
  return isMysqlSystemDatabase(name)
}

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

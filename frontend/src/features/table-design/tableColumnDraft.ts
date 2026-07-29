import type { ColumnMeta } from '../../api/types'
import {
  defaultTypeParams,
  formatColumnTypeSQL,
  isIntegerColumnType,
  MYSQL_COLUMN_TYPES,
} from './mysqlColumnTypes'
import { buildCreateTableIndexLines, buildStandaloneCreateIndexSQL, buildIndexAlterSQL, type IndexDraft } from './tableIndexDraft'

export type ColumnDraftStatus = 'existing' | 'new' | 'deleted'
export type DefaultValueKind = 'none' | 'null' | 'literal' | 'current_timestamp'

/** TableColumnDraft 表字段编辑草稿。 */
export interface TableColumnDraft {
  id: string
  name: string
  originName?: string
  status: ColumnDraftStatus
  typeId: string
  length?: number
  precision?: number
  scale?: number
  nullable: boolean
  primaryKey: boolean
  autoIncrement: boolean
  defaultKind: DefaultValueKind
  defaultValue: string
  comment: string
}

/** newColumnDraft 创建新列草稿。 */
export function newColumnDraft(): TableColumnDraft {
  return {
    id: `col-${Date.now()}-${Math.random()}`,
    name: '',
    status: 'new',
    typeId: 'varchar',
    length: 255,
    nullable: true,
    primaryKey: false,
    autoIncrement: false,
    defaultKind: 'none',
    defaultValue: '',
    comment: '',
  }
}

/** parseDefaultFromMeta 解析列默认值。 */
export function parseDefaultFromMeta(col: ColumnMeta): { defaultKind: DefaultValueKind; defaultValue: string } {
  if ((col.extra || '').toLowerCase().includes('auto_increment')) {
    return { defaultKind: 'none', defaultValue: '' }
  }
  const dv = col.defaultValue
  if (dv === undefined || dv === null || dv === '') {
    return { defaultKind: 'none', defaultValue: '' }
  }
  const upper = dv.toUpperCase()
  if (upper === 'NULL') return { defaultKind: 'null', defaultValue: '' }
  if (upper.includes('CURRENT_TIMESTAMP')) return { defaultKind: 'current_timestamp', defaultValue: '' }
  return { defaultKind: 'literal', defaultValue: dv }
}

/** columnMetaToDraft 将元数据列转为编辑草稿。 */
export function columnMetaToDraft(col: ColumnMeta): TableColumnDraft {
  const parsed = parseMysqlColumnType(col.columnType || col.dataType)
  const def = parseDefaultFromMeta(col)
  const extra = (col.extra || '').toLowerCase()
  const typeRaw = (col.columnType || col.dataType || '').toLowerCase()
  // SQLite INTEGER PRIMARY KEY 视为自增
  const sqliteAuto =
    col.isPrimaryKey && (typeRaw === 'integer' || typeRaw === 'int') && !extra.includes('auto_increment')
  return {
    id: `col-${col.name}`,
    name: col.name,
    originName: col.name,
    status: 'existing',
    typeId: parsed.typeId,
    length: parsed.length,
    precision: parsed.precision,
    scale: parsed.scale,
    nullable: col.nullable,
    primaryKey: col.isPrimaryKey,
    autoIncrement: extra.includes('auto_increment') || sqliteAuto,
    defaultKind: def.defaultKind,
    defaultValue: def.defaultValue,
    comment: col.comment || '',
  }
}

/** parseMysqlColumnType 解析 information_schema 列类型。 */
export function parseMysqlColumnType(columnType: string): {
  typeId: string
  length?: number
  precision?: number
  scale?: number
} {
  const raw = columnType
    .toLowerCase()
    .replace(/\s+unsigned/g, '')
    .replace(/\s+zerofill/g, '')
    .trim()

  const decimal = raw.match(/^decimal\((\d+)\s*,\s*(\d+)\)/)
  if (decimal) {
    return { typeId: 'decimal', precision: Number(decimal[1]), scale: Number(decimal[2]) }
  }

  const withLen = raw.match(/^([a-z]+)\((\d+)\)/)
  if (withLen) {
    return { typeId: mapTypeName(withLen[1]), length: Number(withLen[2]) }
  }

  return { typeId: mapTypeName(raw.split(/\s+/)[0]) }
}

/** mapTypeName 映射 MySQL 类型名到内部 id。 */
function mapTypeName(name: string): string {
  if (name === 'integer') return 'int'
  const hit = MYSQL_COLUMN_TYPES.find((t) => t.id === name || t.label.toLowerCase() === name)
  return hit?.id ?? 'varchar'
}

/** quoteSQLString 转义 SQL 字符串。 */
export function quoteSQLString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** formatDefaultSQL 生成 DEFAULT 子句。 */
export function formatDefaultSQL(col: TableColumnDraft): string {
  if (col.autoIncrement) return ''
  switch (col.defaultKind) {
    case 'null':
      return 'DEFAULT NULL'
    case 'current_timestamp':
      return 'DEFAULT CURRENT_TIMESTAMP'
    case 'literal': {
      const val = col.defaultValue.trim()
      if (val === '') return ''
      const numTypes = ['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'decimal', 'float', 'double']
      if (numTypes.includes(col.typeId) && /^-?\d+(\.\d+)?$/.test(val)) {
        return `DEFAULT ${val}`
      }
      return `DEFAULT ${quoteSQLString(col.defaultValue)}`
    }
    default:
      return ''
  }
}

/** columnDefinitionSQL 生成单列定义 SQL。 */
export function columnDefinitionSQL(col: TableColumnDraft, dialect: SqlDialect = 'mysql'): string {
  const typeSQL = formatColumnTypeSQL(col.typeId, col.length, col.precision, col.scale)
  let def = typeSQL
  if (!col.nullable) def += ' NOT NULL'
  const defaultSQL = formatDefaultSQL(col)
  if (defaultSQL) def += ` ${defaultSQL}`
  if (col.autoIncrement && isIntegerColumnType(col.typeId)) {
    if (dialect === 'sqlite') {
      // SQLite 自增需写在 PRIMARY KEY 上，列级 AUTOINCREMENT 在建表时单独处理
    } else if (dialect === 'postgresql') {
      // 交由 SERIAL / 建表逻辑；列定义保持类型
    } else {
      def += ' AUTO_INCREMENT'
    }
  }
  if (col.comment.trim() && dialect === 'mysql') {
    def += ` COMMENT ${quoteSQLString(col.comment.trim())}`
  }
  return def
}

export type SqlDialect = 'mysql' | 'postgresql' | 'sqlite'

/** snapshotColumn 用于对比列是否变更。 */
function snapshotColumn(col: TableColumnDraft) {
  return {
    name: col.name.trim(),
    typeId: col.typeId,
    length: col.length,
    precision: col.precision,
    scale: col.scale,
    nullable: col.nullable,
    autoIncrement: col.autoIncrement,
    defaultKind: col.defaultKind,
    defaultValue: col.defaultValue,
    comment: col.comment,
  }
}

/** columnsEqual 判断列定义是否相同。 */
function columnsEqual(a: TableColumnDraft, b: TableColumnDraft): boolean {
  return JSON.stringify(snapshotColumn(a)) === JSON.stringify(snapshotColumn(b))
}

/** activeColumns 获取未删除的有效列。 */
export function activeColumns(columns: TableColumnDraft[]): TableColumnDraft[] {
  return columns.filter((c) => c.status !== 'deleted' && c.name.trim())
}

/** quoteIdent 按方言引用标识符。 */
function quoteIdent(name: string, dialect: SqlDialect): string {
  if (dialect === 'postgresql' || dialect === 'sqlite') return `"${name.replace(/"/g, '""')}"`
  return `\`${name.replace(/`/g, '``')}\``
}

/** buildCreateTableSQL 生成建表语句。 */
export function buildCreateTableSQL(
  database: string,
  table: string,
  columns: TableColumnDraft[],
  indexes: IndexDraft[] = [],
  dialect: SqlDialect = 'mysql',
): string {
  const valid = activeColumns(columns)
  if (!table.trim() || valid.length === 0) return ''
  const q = (n: string) => quoteIdent(n, dialect)
  const lines: string[] = []
  const pkCols: string[] = []
  for (const col of valid) {
    const name = col.name.trim()
    if (dialect === 'sqlite' && col.autoIncrement && isIntegerColumnType(col.typeId) && col.primaryKey) {
      lines.push(`  ${q(name)} INTEGER PRIMARY KEY AUTOINCREMENT`)
      continue
    }
    lines.push(`  ${q(name)} ${columnDefinitionSQL(col, dialect)}`)
    if (col.primaryKey) pkCols.push(name)
  }
  const sqliteInlinePk = dialect === 'sqlite' && valid.some((c) => c.autoIncrement && c.primaryKey)
  if (pkCols.length > 0 && !sqliteInlinePk) {
    lines.push(`  PRIMARY KEY (${pkCols.map((n) => q(n)).join(', ')})`)
  }
  if (dialect === 'mysql') {
    lines.push(...buildCreateTableIndexLines(indexes))
  }
  const tbl =
    dialect === 'sqlite'
      ? q(table.trim())
      : database.trim()
        ? `${q(database.trim())}.${q(table.trim())}`
        : q(table.trim())
  let sql: string
  if (dialect === 'mysql') {
    sql = `CREATE TABLE ${tbl} (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  } else {
    sql = `CREATE TABLE ${tbl} (\n${lines.join(',\n')}\n);`
  }
  if (dialect === 'sqlite' || dialect === 'postgresql') {
    const idxStmts = buildStandaloneCreateIndexSQL(table.trim(), indexes, dialect)
    if (idxStmts.length) sql = `${sql}\n${idxStmts.join('\n')}`
  }
  return sql
}

/** buildAlterTableSQL 对比原列与当前列生成 ALTER 语句。 */
export function buildAlterTableSQL(
  database: string,
  table: string,
  original: TableColumnDraft[],
  current: TableColumnDraft[],
  originalIndexes: IndexDraft[] = [],
  currentIndexes: IndexDraft[] = []
): string {
  if (!database.trim() || !table.trim()) return ''
  const tbl = `\`${database.trim()}\`.\`${table.trim()}\``
  const stmts: string[] = []
  const clauses: string[] = []

  const origActive = original.filter((c) => c.status !== 'deleted')
  const curActive = activeColumns(current)

  for (const col of current) {
    if (col.status === 'deleted' && col.originName) {
      clauses.push(`DROP COLUMN \`${col.originName}\``)
    }
  }

  for (const col of curActive) {
    if (col.status === 'new') {
      clauses.push(`ADD COLUMN \`${col.name.trim()}\` ${columnDefinitionSQL(col)}`)
      continue
    }
    const orig = origActive.find((o) => o.originName === col.originName)
    if (!orig) continue
    const renamed = col.originName && col.name.trim() !== col.originName
    const changed = !columnsEqual(col, orig)
    if (!renamed && !changed) continue
    const def = columnDefinitionSQL(col)
    if (renamed) {
      clauses.push(`CHANGE COLUMN \`${col.originName}\` \`${col.name.trim()}\` ${def}`)
    } else {
      clauses.push(`MODIFY COLUMN \`${col.name.trim()}\` ${def}`)
    }
  }

  if (clauses.length > 0) {
    stmts.push(`ALTER TABLE ${tbl}\n  ${clauses.join(',\n  ')};`)
  }

  const origPk = origActive.filter((c) => c.primaryKey).map((c) => c.originName || c.name)
  const newPk = curActive.filter((c) => c.primaryKey).map((c) => c.name.trim())
  const pkChanged = origPk.slice().sort().join(',') !== newPk.slice().sort().join(',')
  if (pkChanged) {
    if (origPk.length > 0) {
      stmts.push(`ALTER TABLE ${tbl} DROP PRIMARY KEY;`)
    }
    if (newPk.length > 0) {
      stmts.push(`ALTER TABLE ${tbl} ADD PRIMARY KEY (${newPk.map((n) => `\`${n}\``).join(', ')});`)
    }
  }

  stmts.push(...buildIndexAlterSQL(database, table, originalIndexes, currentIndexes))

  return stmts.join('\n')
}

/** validateColumnDrafts 校验列草稿。 */
export function validateColumnDrafts(columns: TableColumnDraft[]): string | null {
  const valid = activeColumns(columns)
  if (valid.length === 0) return '至少保留一列'
  const names = valid.map((c) => c.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) return '列名不能重复'
  if (valid.some((c) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name.trim()))) {
    return '列名只能包含字母、数字和下划线'
  }
  if (valid.some((c) => c.autoIncrement && c.defaultKind !== 'none')) {
    return '自增列不能设置默认值'
  }
  return null
}

/** applyColumnPatch 应用列更新并处理类型联动。 */
export function applyColumnPatch(col: TableColumnDraft, patch: Partial<TableColumnDraft>): TableColumnDraft {
  let next = { ...col, ...patch }
  if (patch.typeId && patch.typeId !== col.typeId) {
    const params = defaultTypeParams(patch.typeId)
    next = {
      ...next,
      length: params.length,
      precision: params.precision,
      scale: params.scale,
      autoIncrement: isIntegerColumnType(patch.typeId) ? next.autoIncrement : false,
    }
  }
  if (!isIntegerColumnType(next.typeId)) {
    next.autoIncrement = false
  }
  if (next.autoIncrement) {
    next.defaultKind = 'none'
    next.defaultValue = ''
  }
  return next
}

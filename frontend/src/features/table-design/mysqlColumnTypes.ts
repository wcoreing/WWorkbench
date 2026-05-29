/** MySQL 字段类型长度配置。 */
export interface TypeLengthSpec {
  default: number
  min: number
  max: number
}

/** MySQL 字段类型精度配置（DECIMAL）。 */
export interface TypePrecisionSpec {
  precisionDefault: number
  scaleDefault: number
  precisionMax: number
  scaleMax: number
}

/** MySQL 字段类型定义。 */
export interface MysqlColumnTypeDef {
  id: string
  label: string
  category: string
  length?: TypeLengthSpec
  precision?: TypePrecisionSpec
  integer?: boolean
}

/** MYSQL_COLUMN_TYPES 常用 MySQL 字段类型列表。 */
export const MYSQL_COLUMN_TYPES: MysqlColumnTypeDef[] = [
  { id: 'varchar', label: 'VARCHAR', category: '字符串', length: { default: 255, min: 1, max: 65535 } },
  { id: 'char', label: 'CHAR', category: '字符串', length: { default: 32, min: 1, max: 255 } },
  { id: 'text', label: 'TEXT', category: '字符串' },
  { id: 'mediumtext', label: 'MEDIUMTEXT', category: '字符串' },
  { id: 'longtext', label: 'LONGTEXT', category: '字符串' },
  { id: 'tinyint', label: 'TINYINT', category: '整数', integer: true },
  { id: 'smallint', label: 'SMALLINT', category: '整数', integer: true },
  { id: 'mediumint', label: 'MEDIUMINT', category: '整数', integer: true },
  { id: 'int', label: 'INT', category: '整数', integer: true },
  { id: 'bigint', label: 'BIGINT', category: '整数', integer: true },
  {
    id: 'decimal',
    label: 'DECIMAL',
    category: '小数',
    precision: { precisionDefault: 10, scaleDefault: 2, precisionMax: 65, scaleMax: 30 },
  },
  { id: 'float', label: 'FLOAT', category: '小数' },
  { id: 'double', label: 'DOUBLE', category: '小数' },
  { id: 'date', label: 'DATE', category: '日期时间' },
  { id: 'time', label: 'TIME', category: '日期时间' },
  { id: 'datetime', label: 'DATETIME', category: '日期时间' },
  { id: 'timestamp', label: 'TIMESTAMP', category: '日期时间' },
  { id: 'json', label: 'JSON', category: '其他' },
  { id: 'blob', label: 'BLOB', category: '二进制' },
  { id: 'mediumblob', label: 'MEDIUMBLOB', category: '二进制' },
  { id: 'longblob', label: 'LONGBLOB', category: '二进制' },
]

const typeMap = new Map(MYSQL_COLUMN_TYPES.map((t) => [t.id, t]))

/** getColumnTypeDef 按 id 获取类型定义。 */
export function getColumnTypeDef(typeId: string): MysqlColumnTypeDef | undefined {
  return typeMap.get(typeId)
}

/** isIntegerColumnType 是否整数类型（可自增）。 */
export function isIntegerColumnType(typeId: string): boolean {
  return getColumnTypeDef(typeId)?.integer === true
}

/** formatColumnTypeSQL 生成列类型 SQL 片段。 */
export function formatColumnTypeSQL(typeId: string, length?: number, precision?: number, scale?: number): string {
  const def = getColumnTypeDef(typeId)
  if (!def) return 'VARCHAR(255)'
  if (def.precision) {
    const p = clamp(precision ?? def.precision.precisionDefault, 1, def.precision.precisionMax)
    const s = clamp(scale ?? def.precision.scaleDefault, 0, def.precision.scaleMax)
    return `${def.label}(${p},${s})`
  }
  if (def.length) {
    const len = clamp(length ?? def.length.default, def.length.min, def.length.max)
    return `${def.label}(${len})`
  }
  return def.label
}

/** defaultTypeParams 返回类型切换后的默认长度/精度。 */
export function defaultTypeParams(typeId: string): { length?: number; precision?: number; scale?: number } {
  const def = getColumnTypeDef(typeId)
  if (!def) return { length: 255 }
  if (def.precision) {
    return { precision: def.precision.precisionDefault, scale: def.precision.scaleDefault }
  }
  if (def.length) {
    return { length: def.length.default }
  }
  return {}
}

/** columnTypeOptionsByCategory 按分类分组供下拉使用。 */
export function columnTypeOptionsByCategory(): { category: string; options: MysqlColumnTypeDef[] }[] {
  const map = new Map<string, MysqlColumnTypeDef[]>()
  for (const t of MYSQL_COLUMN_TYPES) {
    if (!map.has(t.category)) map.set(t.category, [])
    map.get(t.category)!.push(t)
  }
  return [...map.entries()].map(([category, options]) => ({ category, options }))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)))
}

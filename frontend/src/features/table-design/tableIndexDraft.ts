import type { IndexMeta } from '../../api/types'

export type IndexDraftStatus = 'existing' | 'new' | 'deleted'

/** IndexDraft 索引编辑草稿。 */
export interface IndexDraft {
  id: string
  name: string
  originName?: string
  status: IndexDraftStatus
  columns: string[]
  unique: boolean
}

/** newIndexDraft 创建新索引草稿。 */
export function newIndexDraft(): IndexDraft {
  return {
    id: `idx-${Date.now()}-${Math.random()}`,
    name: '',
    status: 'new',
    columns: [],
    unique: false,
  }
}

/** indexMetaToDrafts 将索引元数据转为编辑草稿（不含 PRIMARY）。 */
export function indexMetaToDrafts(metas: IndexMeta[]): IndexDraft[] {
  const map = new Map<string, IndexDraft>()
  for (const m of metas) {
    if (m.name === 'PRIMARY' || m.name.startsWith('sqlite_autoindex_')) continue
    if (!map.has(m.name)) {
      map.set(m.name, {
        id: `idx-${m.name}`,
        name: m.name,
        originName: m.name,
        status: 'existing',
        columns: [],
        unique: !m.nonUnique,
      })
    }
    // SQLite 适配器可能把多列拼成 "a,b"；MySQL 每行一列。
    const parts = m.column.includes(',')
      ? m.column.split(',').map((s) => s.trim()).filter(Boolean)
      : [m.column.trim()].filter(Boolean)
    map.get(m.name)!.columns.push(...parts)
  }
  return [...map.values()]
}

/** activeIndexes 获取未删除的有效索引。 */
export function activeIndexes(indexes: IndexDraft[]): IndexDraft[] {
  return indexes.filter((i) => i.status !== 'deleted' && i.name.trim() && i.columns.length > 0)
}

/** formatIndexColumnsSQL 格式化索引列列表。 */
function formatIndexColumnsSQL(columns: string[], dialect: 'mysql' | 'postgresql' | 'sqlite' = 'mysql'): string {
  return columns
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (dialect === 'mysql' ? `\`${c.replace(/`/g, '``')}\`` : `"${c.replace(/"/g, '""')}"`))
    .join(', ')
}

/** buildCreateTableIndexLines 生成建表内联索引行（仅 MySQL）。 */
export function buildCreateTableIndexLines(indexes: IndexDraft[]): string[] {
  return activeIndexes(indexes).map((idx) => {
    const cols = formatIndexColumnsSQL(idx.columns, 'mysql')
    return idx.unique
      ? `  UNIQUE KEY \`${idx.name.trim()}\` (${cols})`
      : `  KEY \`${idx.name.trim()}\` (${cols})`
  })
}

/** buildStandaloneCreateIndexSQL 生成独立 CREATE INDEX（SQLite / PostgreSQL）。 */
export function buildStandaloneCreateIndexSQL(
  table: string,
  indexes: IndexDraft[],
  dialect: 'postgresql' | 'sqlite' = 'sqlite',
): string[] {
  const q = (n: string) => `"${n.replace(/"/g, '""')}"`
  return activeIndexes(indexes).map((idx) => {
    const cols = formatIndexColumnsSQL(idx.columns, dialect)
    const uniq = idx.unique ? 'UNIQUE ' : ''
    return `CREATE ${uniq}INDEX ${q(idx.name.trim())} ON ${q(table.trim())} (${cols});`
  })
}

/** buildIndexAlterSQL 生成索引变更 ALTER 语句。 */
export function buildIndexAlterSQL(
  database: string,
  table: string,
  original: IndexDraft[],
  current: IndexDraft[]
): string[] {
  const tbl = `\`${database.trim()}\`.\`${table.trim()}\``
  const stmts: string[] = []

  for (const idx of current) {
    if (idx.status === 'deleted' && idx.originName) {
      stmts.push(`ALTER TABLE ${tbl} DROP INDEX \`${idx.originName}\`;`)
    }
  }

  for (const idx of activeIndexes(current)) {
    if (idx.status === 'new') {
      const cols = formatIndexColumnsSQL(idx.columns)
      const unique = idx.unique ? 'UNIQUE ' : ''
      stmts.push(`ALTER TABLE ${tbl} ADD ${unique}INDEX \`${idx.name.trim()}\` (${cols});`)
      continue
    }
    const orig = original.find((o) => o.originName === idx.originName)
    if (!orig) continue
    const renamed = idx.originName && idx.name.trim() !== idx.originName
    const changed =
      renamed ||
      idx.unique !== orig.unique ||
      idx.columns.join(',') !== orig.columns.join(',')
    if (!changed) continue
    if (orig.originName) {
      stmts.push(`ALTER TABLE ${tbl} DROP INDEX \`${orig.originName}\`;`)
    }
    const cols = formatIndexColumnsSQL(idx.columns)
    const unique = idx.unique ? 'UNIQUE ' : ''
    stmts.push(`ALTER TABLE ${tbl} ADD ${unique}INDEX \`${idx.name.trim()}\` (${cols});`)
  }

  return stmts
}

/** validateIndexDrafts 校验索引草稿。 */
export function validateIndexDrafts(indexes: IndexDraft[], columnNames: string[]): string | null {
  const colSet = new Set(columnNames.map((n) => n.toLowerCase()))
  const active = activeIndexes(indexes)
  const names = active.map((i) => i.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) return '索引名不能重复'
  for (const idx of active) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idx.name.trim())) {
      return `索引名 ${idx.name} 格式无效`
    }
    if (idx.name.trim().toUpperCase() === 'PRIMARY') {
      return '请通过主键列设置 PRIMARY，不要创建名为 PRIMARY 的索引'
    }
    for (const col of idx.columns) {
      if (!colSet.has(col.trim().toLowerCase())) {
        return `索引 ${idx.name} 引用了不存在的列 ${col}`
      }
    }
  }
  return null
}

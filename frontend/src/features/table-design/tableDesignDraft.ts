import type { TableDesignTab } from './TableDesignPanel'
import type { TableColumnDraft } from './tableColumnDraft'
import type { IndexDraft } from './tableIndexDraft'

/** TableDesignDraft 表设计 Tab 草稿（切换 Tab 时保持）。 */
export interface TableDesignDraft {
  tab: TableDesignTab
  tableName: string
  columns: TableColumnDraft[]
  indexes: IndexDraft[]
  original: TableColumnDraft[]
  originalIndexes: IndexDraft[]
  hydrated: boolean
}

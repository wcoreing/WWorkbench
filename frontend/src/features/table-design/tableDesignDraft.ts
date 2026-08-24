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
  /** alterTable 修改表模式下对应的表名，用于校验草稿是否匹配。 */
  alterTable?: string
}

/** draftHasLoadedStructure 修改表草稿是否已从服务端加载过结构（非占位行）。 */
export function draftHasLoadedStructure(draft: TableDesignDraft, isCreate: boolean): boolean {
  if (isCreate) return (draft.columns?.length ?? 0) > 0
  if ((draft.original?.length ?? 0) > 0) return true
  return (draft.columns ?? []).some((c) => c.status === 'existing')
}

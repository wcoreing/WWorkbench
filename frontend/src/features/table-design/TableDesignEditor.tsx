import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useAppStore } from '../../stores/appStore'
import { ColumnEditorRows } from './ColumnEditorRows'
import { IndexEditorRows } from './IndexEditorRows'
import { TableDesignPanel, type TableDesignTab } from './TableDesignPanel'
import type { TableDesignDraft } from './tableDesignDraft'
import {
  activeColumns,
  buildAlterTableSQL,
  buildCreateTableSQL,
  columnMetaToDraft,
  newColumnDraft,
  validateColumnDrafts,
  type TableColumnDraft,
} from './tableColumnDraft'
import {
  activeIndexes,
  indexMetaToDrafts,
  newIndexDraft,
  validateIndexDrafts,
  type IndexDraft,
} from './tableIndexDraft'
import '../../components/ui.css'

interface Props {
  tabId: string
  sessionId: string
  database: string
  mode: 'create' | 'alter'
  table?: string
  onSaved: () => void
  onCreated?: (tableName: string) => void
  onStatus: (msg: string) => void
  onOpenDDL: (sql: string, title: string) => void
}

/** loadTableStructure 从服务端加载表结构草稿。 */
async function loadTableStructure(sessionId: string, database: string, table: string) {
  const [cols, idxs] = await Promise.all([
    api.listColumns(sessionId, database, table),
    api.listIndexes(sessionId, database, table),
  ])
  const drafts = cols.map(columnMetaToDraft)
  const idxDrafts = indexMetaToDrafts(idxs)
  return {
    columns: drafts,
    indexes: idxDrafts,
    original: structuredClone(drafts),
    originalIndexes: structuredClone(idxDrafts),
  }
}

/** TableDesignEditor 表结构设计（新建 / 修改）。 */
export function TableDesignEditor({
  tabId,
  sessionId,
  database,
  mode,
  table,
  onSaved,
  onCreated,
  onStatus,
  onOpenDDL,
}: Props) {
  const isCreate = mode === 'create'
  const setDesignDraft = useAppStore((s) => s.setDesignDraft)
  const [tab, setTab] = useState<TableDesignTab>('fields')
  const [tableName, setTableName] = useState('')
  const [original, setOriginal] = useState<TableColumnDraft[]>([])
  const [columns, setColumns] = useState<TableColumnDraft[]>([newColumnDraft()])
  const [originalIndexes, setOriginalIndexes] = useState<IndexDraft[]>([])
  const [indexes, setIndexes] = useState<IndexDraft[]>([])
  const [loading, setLoading] = useState(!isCreate)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  /** applyDraft 将草稿应用到组件状态。 */
  const applyDraft = useCallback((draft: TableDesignDraft) => {
    setTab(draft.tab)
    setTableName(draft.tableName)
    setColumns(draft.columns)
    setIndexes(draft.indexes)
    setOriginal(draft.original)
    setOriginalIndexes(draft.originalIndexes)
  }, [])

  /** persistDraft 写入 store 草稿。 */
  const persistDraft = useCallback(
    (patch: Partial<TableDesignDraft> & { hydrated?: boolean }) => {
      setDesignDraft(tabId, {
        tab: patch.tab ?? tab,
        tableName: patch.tableName ?? tableName,
        columns: patch.columns ?? columns,
        indexes: patch.indexes ?? indexes,
        original: patch.original ?? original,
        originalIndexes: patch.originalIndexes ?? originalIndexes,
        hydrated: patch.hydrated ?? true,
      })
    },
    [tabId, tab, tableName, columns, indexes, original, originalIndexes, setDesignDraft]
  )

  useEffect(() => {
    setError('')
    setRunning(false)
    const cached = useAppStore.getState().designDrafts[tabId]
    if (cached?.hydrated) {
      applyDraft(cached)
      setLoading(false)
      return
    }
    if (isCreate) {
      setTab('fields')
      setTableName('')
      setColumns([newColumnDraft()])
      setIndexes([])
      setOriginal([])
      setOriginalIndexes([])
      setLoading(false)
      return
    }
    if (!table) return
    let cancelled = false
    setLoading(true)
    loadTableStructure(sessionId, database, table)
      .then((data) => {
        if (cancelled) return
        setOriginal(data.original)
        setColumns(data.columns)
        setOriginalIndexes(data.originalIndexes)
        setIndexes(data.indexes)
        setDesignDraft(tabId, {
          tab: 'fields',
          tableName: '',
          columns: data.columns,
          indexes: data.indexes,
          original: data.original,
          originalIndexes: data.originalIndexes,
          hydrated: true,
        })
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tabId, sessionId, database, table, isCreate, applyDraft, setDesignDraft])

  useEffect(() => {
    if (loading) return
    persistDraft({})
  }, [tab, tableName, columns, indexes, original, originalIndexes, loading, persistDraft])

  const preview = useMemo(() => {
    if (isCreate) return buildCreateTableSQL(database, tableName, columns, indexes)
    if (!table) return ''
    return buildAlterTableSQL(database, table, original, columns, originalIndexes, indexes)
  }, [isCreate, database, tableName, table, original, columns, originalIndexes, indexes])

  const subtitle = isCreate ? `${database} · 新建表` : `${database}.${table}`

  /** reloadAfterSave 保存后从服务端刷新结构。 */
  const reloadAfterSave = async () => {
    if (!table) return
    const data = await loadTableStructure(sessionId, database, table)
    setOriginal(data.original)
    setColumns(data.columns)
    setOriginalIndexes(data.originalIndexes)
    setIndexes(data.indexes)
    setTab('fields')
    setDesignDraft(tabId, {
      tab: 'fields',
      tableName: '',
      columns: data.columns,
      indexes: data.indexes,
      original: data.original,
      originalIndexes: data.originalIndexes,
      hydrated: true,
    })
  }

  /** save 校验并执行 SQL。 */
  const save = async () => {
    setError('')
    if (isCreate && !tableName.trim()) {
      setError('请填写表名')
      setTab('fields')
      return
    }
    const colErr = validateColumnDrafts(columns)
    if (colErr) {
      setError(colErr)
      setTab('fields')
      return
    }
    const colNames = activeColumns(columns).map((c) => c.name.trim())
    const idxErr = validateIndexDrafts(indexes, colNames)
    if (idxErr) {
      setError(idxErr)
      setTab('indexes')
      return
    }
    const sql = preview.trim()
    if (!sql) {
      setError(isCreate ? '请填写至少一列' : '没有结构变更')
      setTab(isCreate ? 'fields' : 'sql')
      return
    }
    setRunning(true)
    onStatus('正在保存...')
    try {
      await api.executeSQL(sessionId, database, sql)
      if (isCreate) {
        const name = tableName.trim()
        onStatus(`表 ${name} 已创建`)
        onSaved()
        onCreated?.(name)
        return
      }
      onStatus(`表 ${table} 已更新`)
      onSaved()
      await reloadAfterSave()
    } catch (e) {
      setError((e as Error).message)
      onStatus((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  /** openAsDDL 打开 SQL 为 DDL 标签页。 */
  const openAsDDL = () => {
    const sql = preview.trim()
    if (!sql) {
      setError(isCreate ? '请先生成 SQL' : '没有结构变更')
      setTab('sql')
      return
    }
    const title = isCreate ? `新建 · ${tableName || '表'}` : `修改 · ${table}`
    onOpenDDL(sql, title)
  }

  const toolbar = (
    <>
      <button type="button" className="wn-btn wn-btn-tool" onClick={() => openAsDDL()} disabled={running || loading}>
        打开为 DDL
      </button>
      <button
        type="button"
        className="wn-btn wn-btn-tool wn-btn-accent"
        onClick={() => void save()}
        disabled={running || loading || (!isCreate && !preview.trim())}
      >
        {running ? '保存中…' : '保存'}
      </button>
    </>
  )

  const metaBar = isCreate ? (
    <div className="table-design-meta-row">
      <label>数据库</label>
      <input className="wn-input" value={database} readOnly />
      <label>表名</label>
      <input
        className="wn-input"
        value={tableName}
        onChange={(e) => setTableName(e.target.value)}
        placeholder="users"
      />
    </div>
  ) : undefined

  return (
    <TableDesignPanel
      subtitle={subtitle}
      tab={tab}
      onTabChange={setTab}
      fieldCount={activeColumns(columns).length}
      indexCount={activeIndexes(indexes).length}
      metaBar={metaBar}
      loading={loading}
      error={error}
      sqlPreview={preview}
      sqlPlaceholder={
        isCreate
          ? '-- 填写表名与字段后将在此生成 CREATE TABLE 语句'
          : '-- 修改字段或索引后将在此生成 ALTER TABLE 语句'
      }
      toolbar={toolbar}
      fieldsPane={
        <>
          <div className="table-design-toolbar">
            <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" onClick={() => setColumns((p) => [...p, newColumnDraft()])}>
              + 添加字段
            </button>
          </div>
          <ColumnEditorRows columns={columns} onChange={setColumns} allowRemoveLast={isCreate} />
        </>
      }
      indexesPane={
        <>
          <div className="table-design-toolbar">
            <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" onClick={() => setIndexes((p) => [...p, newIndexDraft()])}>
              + 添加索引
            </button>
          </div>
          <IndexEditorRows indexes={indexes} columns={columns} onChange={setIndexes} />
        </>
      }
    />
  )
}

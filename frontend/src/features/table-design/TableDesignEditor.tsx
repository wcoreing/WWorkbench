import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { isTableMissing } from '../../api/errors'
import { useAppStore } from '../../stores/appStore'
import { useLoading, withLoading } from '../../stores/loadingStore'
import { ColumnEditorRows } from './ColumnEditorRows'
import { IndexEditorRows } from './IndexEditorRows'
import { TableDesignPanel, type TableDesignTab } from './TableDesignPanel'
import { draftHasLoadedStructure, type TableDesignDraft } from './tableDesignDraft'
import { pressProps } from '../../components/compat'
import {
  activeColumns,
  buildAlterTableSQL,
  buildCreateTableSQL,
  columnMetaToDraft,
  newColumnDraft,
  validateColumnDrafts,
  type SqlDialect,
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
  dbType?: string
  mode: 'create' | 'alter'
  table?: string
  onSaved: () => void
  onCreated?: (tableName: string) => void
  onStatus: (msg: string) => void
  onOpenDDL: (sql: string, title: string) => void
  /** 表已不存在时回调（由工作台关闭 Tab）。 */
  onTableMissing?: () => void
}

/** loadTableStructure 从服务端加载表结构草稿。SQLite 单连接，串行请求避免排队卡死感。 */
async function loadTableStructure(sessionId: string, database: string, table: string) {
  const cols = await api.listColumns(sessionId, database, table)
  const idxs = await api.listIndexes(sessionId, database, table)
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
  dbType = 'mysql',
  mode,
  table,
  onSaved,
  onCreated,
  onStatus,
  onOpenDDL,
  onTableMissing,
}: Props) {
  const isCreate = mode === 'create'
  const dialect: SqlDialect =
    dbType === 'sqlite' ? 'sqlite' : dbType === 'postgresql' ? 'postgresql' : 'mysql'
  const setDesignDraft = useAppStore((s) => s.setDesignDraft)
  const clearDesignDraft = useAppStore((s) => s.clearDesignDraft)
  const onTableMissingRef = useRef(onTableMissing)
  onTableMissingRef.current = onTableMissing
  const [tab, setTab] = useState<TableDesignTab>('fields')
  const [tableName, setTableName] = useState('')
  const [original, setOriginal] = useState<TableColumnDraft[]>([])
  const [columns, setColumns] = useState<TableColumnDraft[]>(() => (isCreate ? [newColumnDraft()] : []))
  const [originalIndexes, setOriginalIndexes] = useState<IndexDraft[]>([])
  const [indexes, setIndexes] = useState<IndexDraft[]>([])
  const designLoadingKey = `table.design.${tabId}`
  const designLoading = useLoading(designLoadingKey)
  const [structureLoaded, setStructureLoaded] = useState(isCreate)
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
        alterTable: isCreate ? undefined : table,
      })
    },
    [tabId, tab, tableName, columns, indexes, original, originalIndexes, setDesignDraft, isCreate, table]
  )

  useEffect(() => {
    setError('')
    setRunning(false)
    setStructureLoaded(isCreate)
    const cached = useAppStore.getState().designDrafts[tabId]
    const cacheMatchesTable = !table || cached?.alterTable === table || !cached?.alterTable
    // 修改表：必须已有 original/既有列，避免占位行草稿跳过加载
    if (
      cached?.hydrated &&
      cacheMatchesTable &&
      draftHasLoadedStructure(cached, isCreate)
    ) {
      applyDraft(cached)
      setStructureLoaded(true)
      return
    }
    if (cached?.hydrated && !isCreate) {
      clearDesignDraft(tabId)
    }
    if (isCreate) {
      setTab('fields')
      setTableName('')
      setColumns([newColumnDraft()])
      setIndexes([])
      setOriginal([])
      setOriginalIndexes([])
      return
    }
    if (!table) {
      setError('缺少表名')
      return
    }
    let cancelled = false
    void withLoading(
      designLoadingKey,
      async () => {
        const data = await loadTableStructure(sessionId, database, table)
        if (cancelled) return
        setOriginal(data.original)
        setColumns(data.columns.length ? data.columns : [newColumnDraft()])
        setOriginalIndexes(data.originalIndexes)
        setIndexes(data.indexes)
        setStructureLoaded(true)
        setDesignDraft(tabId, {
          tab: 'fields',
          tableName: '',
          columns: data.columns.length ? data.columns : [newColumnDraft()],
          indexes: data.indexes,
          original: data.original,
          originalIndexes: data.originalIndexes,
          hydrated: true,
          alterTable: table,
        })
      },
      {
        label: '加载表结构…',
        onBegin: () => {
          if (cancelled) return
          setColumns([])
          setIndexes([])
          setOriginal([])
          setOriginalIndexes([])
        },
      },
    ).catch((e) => {
      if (cancelled) return
      if (isTableMissing(e)) {
        onTableMissingRef.current?.()
        return
      }
      setError((e as Error).message)
      setColumns((prev) => (prev.length ? prev : [newColumnDraft()]))
    })
    return () => {
      cancelled = true
    }
  }, [tabId, sessionId, database, table, isCreate, applyDraft, setDesignDraft, clearDesignDraft, designLoadingKey])

  useEffect(() => {
    if (designLoading.active) return
    if (!isCreate && !structureLoaded) return
    persistDraft({})
  }, [tab, tableName, columns, indexes, original, originalIndexes, designLoading.active, structureLoaded, isCreate, persistDraft])

  const preview = useMemo(() => {
    if (isCreate) return buildCreateTableSQL(database, tableName, columns, indexes, dialect)
    if (!table) return ''
    return buildAlterTableSQL(database, table, original, columns, originalIndexes, indexes)
  }, [isCreate, database, tableName, table, original, columns, originalIndexes, indexes, dialect])

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
      alterTable: table,
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
      <button
        type="button"
        className="wn-btn wn-btn-tool"
        disabled={running || designLoading.active}
        {...pressProps(() => openAsDDL(), { disabled: running || designLoading.active })}
      >
        打开为 DDL
      </button>
      <button
        type="button"
        className="wn-btn wn-btn-tool wn-btn-accent"
        disabled={running || designLoading.active || (!isCreate && !preview.trim())}
        {...pressProps(() => void save(), {
          disabled: running || designLoading.active || (!isCreate && !preview.trim()),
        })}
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
      loadingKey={isCreate ? undefined : designLoadingKey}
      loadingLabel="加载表结构…"
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
            <button
              type="button"
              className="wn-btn wn-btn-tool wn-btn-sm"
              {...pressProps(() => setColumns((p) => [...p, newColumnDraft()]))}
            >
              + 添加字段
            </button>
          </div>
          <ColumnEditorRows columns={columns} onChange={setColumns} allowRemoveLast={isCreate} />
        </>
      }
      indexesPane={
        <>
          <div className="table-design-toolbar">
            <button
              type="button"
              className="wn-btn wn-btn-tool wn-btn-sm"
              {...pressProps(() => setIndexes((p) => [...p, newIndexDraft()]))}
            >
              + 添加索引
            </button>
          </div>
          <IndexEditorRows indexes={indexes} columns={columns} onChange={setIndexes} />
        </>
      }
    />
  )
}

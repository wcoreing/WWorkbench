import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, ExecuteResult, IndexMeta, QueryHistory, QueryPage, SQLBatchResult, SessionInfo } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import { ProductLayout, PaneCollapseButton, ResizeHandle, SidebarColumns, SidebarStack, usePaneCollapse, useResizable } from '../../components/layout'
import { loadSizeMap, rememberScalarSize, recallScalarSize, type CollapsedMap } from '../../components/layout/layoutStorage'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { IconDisconnect, IconDownload, IconEdit, IconExplain, IconFolder, IconImportSql, IconNotebook, IconPlay, IconPlus, IconRefresh, IconSql, IconTerminal, IconTrash } from '../../components/Icons'
import { Select, pressProps, useDismissOverlays } from '../../components/compat'

import { ConnectionModal } from '../../features/connection/ConnectionModal'
import { DdlEditor } from '../../features/ddl/DdlEditor'
import { ObjectTree } from '../../features/explorer/ObjectTree'
import { CreateDatabaseDialog } from '../../features/database/CreateDatabaseDialog'
import { ResultPanel } from '../../features/sql-editor/ResultPanel'
import { SqlEditor, type SqlEditorHandle } from '../../features/sql-editor/SqlEditor'
import { TableDesignEditor } from '../../features/table-design/TableDesignEditor'
import { TableDataEditor } from '../../features/table-data/TableDataEditor'
import { useAppStore } from '../../stores/appStore'
import { buildDatabaseSurface } from '../../stores/agentSurface'
import { openTerminal, openSftp, openNotebook, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadBool, payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import type { ConnectionDraft } from '../../stores/appStore'
import { APP_SETTING_KEYS, saveAppSetting } from '../../stores/appPreferences'
import { openAgentDraft, mentionDatabase } from '../../features/agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { defaultUntitledSql, localizeWorkTabTitle } from '../../i18n/databaseTabTitle'
import { queryPageToExport } from '../../utils/queryCsv'
import { useScrollActiveTabIntoView } from '../../hooks/useScrollActiveTabIntoView'
import { useSQLExport } from '../../features/export/useSQLExport'

type SqlResult = QueryPage | ExecuteResult | SQLBatchResult

/** isBatchResult 判断是否为多语句结果。 */
function isBatchResult(res: SqlResult): res is SQLBatchResult {
  return 'items' in res && Array.isArray((res as SQLBatchResult).items)
}

/** isQueryPage 判断是否为查询分页结果。 */
function isQueryPage(res: SqlResult): res is QueryPage {
  return 'columns' in res && 'page' in res
}

/** 数据库产品线工作区 */
export function DatabaseWorkbench() {
  const {
    connections,
    activeConnectionId,
    session,
    objectTree,
    tabs,
    activeTabId,
    setConnections,
    setActiveConnectionId,
    setSession,
    setObjectTree,
    setActiveTabId,
    setStatusMessage,
    setActiveProduct,
    addTab,
    replaceTab,
    updateSqlTab,
    updateDdlTab,
    clearDesignDraft,
    statusMessage,
    setAgentSurface,
    activeProduct,
  } = useAppStore()
  const { t } = useI18n()
  const sqlExport = useSQLExport(setStatusMessage)

  const sqlEditorRef = useRef<SqlEditorHandle>(null)
  const pendingSql = useRef<{ sql: string; run: boolean } | null>(null)
  const [connModalOpen, setConnModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<Connection | null>(null)
  const [connCtxMenu, setConnCtxMenu] = useState<{ x: number; y: number; conn: Connection } | null>(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  useDismissOverlays(() => {
    setConnCtxMenu(null)
    setTabCtxMenu(null)
    setExportMenuOpen(false)
  })
  useEffect(() => {
    if (!exportMenuOpen) return
    const close = (e: PointerEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [exportMenuOpen])
  const [sqlResult, setSqlResult] = useState<SqlResult | null>(null)
  const { size: resultHeight, onResizeStart: onResultResizeStart } = useResizable({
    axis: 'y',
    storageKey: 'database_result_height',
    defaultSize: 220,
    min: 120,
    max: 560,
    invert: true,
  })
  const [bottomTab, setBottomTab] = useState<'result' | 'message'>('result')
  const [history, setHistory] = useState<QueryHistory[]>([])
  const [lastQuery, setLastQuery] = useState<{ sql: string; page: QueryPage } | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [treeFilter, setTreeFilter] = useState('')
  const [treeRefreshNonce, setTreeRefreshNonce] = useState(0)
  const [ddlConfirm, setDdlConfirm] = useState<
    | { type: 'truncate' | 'drop'; database: string; table: string }
    | { type: 'drop-database'; database: string }
    | null
  >(null)
  const [deleteConnTarget, setDeleteConnTarget] = useState<Connection | null>(null)
  const [createDbOpen, setCreateDbOpen] = useState(false)
  const restoredConnection = useRef(false)
  const DB_SIDEBAR_WIDTH_KEY = 'database_sidebar_width'
  const DB_SIDEBAR_EXPANDED_KEY = 'database_sidebar_width__expanded'
  const DB_COLUMNS_KEY = 'database_sidebar_columns'
  const {
    size: databaseSidebarWidth,
    setSizeAndSave: setDatabaseSidebarWidth,
    onResizeStart: onDatabaseSidebarResizeStart,
  } = useResizable({
    axis: 'x',
    storageKey: DB_SIDEBAR_WIDTH_KEY,
    defaultSize: 400,
    min: 200,
    max: 720,
  })
  const {
    collapsed: explorerCollapsed,
    setCollapsed: setExplorerCollapsed,
  } = usePaneCollapse(DB_COLUMNS_KEY)

  /** 收起连接栏时同步缩小外层侧栏，把宽度还给主编辑区 */
  const applyExplorerCollapsed = useCallback(
    (next: CollapsedMap) => {
      const was = Boolean(explorerCollapsed.connections)
      const now = Boolean(next.connections)
      if (was !== now) {
        const colSizes = loadSizeMap(DB_COLUMNS_KEY)
        const connW = Math.min(320, Math.max(120, colSizes.connections ?? 168))
        const freed = Math.max(0, connW - 32)
        if (now) {
          rememberScalarSize(DB_SIDEBAR_EXPANDED_KEY, databaseSidebarWidth)
          setDatabaseSidebarWidth(databaseSidebarWidth - freed)
        } else {
          setDatabaseSidebarWidth(
            recallScalarSize(
              DB_SIDEBAR_EXPANDED_KEY,
              databaseSidebarWidth + freed,
              320,
              720,
            ),
          )
        }
      }
      setExplorerCollapsed(next)
    },
    [
      databaseSidebarWidth,
      explorerCollapsed.connections,
      setDatabaseSidebarWidth,
      setExplorerCollapsed,
    ],
  )

  const toggleConnectionsPane = useCallback(() => {
    applyExplorerCollapsed({
      ...explorerCollapsed,
      connections: !explorerCollapsed.connections,
    })
  }, [applyExplorerCollapsed, explorerCollapsed])

  useEffect(() => {
    void refreshConnections()
  }, [])

  useEffect(() => {
    if (activeProduct !== 'database') return
    setAgentSurface(
      buildDatabaseSurface({
        tabs,
        activeTabId,
        connectionId: activeConnectionId ?? session?.connectionId ?? '',
        sessionId: session?.sessionId ?? '',
        sessionDatabase: session?.database ?? '',
      }),
    )
  }, [
    activeProduct,
    tabs,
    activeTabId,
    activeConnectionId,
    session?.connectionId,
    session?.sessionId,
    session?.database,
    setAgentSurface,
  ])

  useEffect(() => {
    if (!connCtxMenu) return
    const close = () => setConnCtxMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [connCtxMenu])

  useEffect(() => {
    if (!tabCtxMenu) return
    const close = () => setTabCtxMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [tabCtxMenu])

  const refreshConnections = useCallback(async () => {
    try {
      const list = await api.listConnections()
      setConnections(list)
    } catch (e) {
      console.error(e)
      setConnections([])
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage])

  useEffect(() => {
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain !== 'database.connection') return
      await refreshConnections()
      if (evt.label) {
        useAppStore.getState().setStatusMessage(
          evt.op === 'delete' ? `连接已删除：${evt.label}` : `连接已更新：${evt.label}`,
        )
      }
    }
    for (const evt of takePendingWorkbenchChanged('database.')) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [refreshConnections])

  /** reloadObjectTree 重拉库列表并失效 ObjectTree 懒加载缓存。 */
  const reloadObjectTree = async (sessionId: string) => {
    setObjectTree(await api.getObjectTree(sessionId))
    setTreeRefreshNonce((n) => n + 1)
  }

  const refreshObjectTree = async () => {
    if (!session) return
    try {
      await reloadObjectTree(session.sessionId)
      setStatusMessage(t('database.treeRefreshed'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const connectionList = connections ?? []
  const treeNodes = objectTree ?? []
  const activeConn = useMemo(
    () => connectionList.find((c) => c.id === (session?.connectionId ?? activeConnectionId)),
    [connectionList, session?.connectionId, activeConnectionId],
  )
  const isRedis = activeConn?.dbType === 'redis'
  const isSqlite = activeConn?.dbType === 'sqlite'
  const isMysql = activeConn?.dbType === 'mysql'
  const canCreateDatabase = !isRedis && !isSqlite
  /** 表设计：非 Redis 可新建；改表设计目前 MySQL / SQLite / PostgreSQL 均可打开。 */
  const canCreateTable = !isRedis
  const canDesignTable = !isRedis
  const groupedConnections = useMemo(() => {
    const map = new Map<string, Connection[]>()
    for (const c of connectionList) {
      const g = c.group?.trim() || t('database.defaultGroup')
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(c)
    }
    return [...map.entries()]
  }, [connectionList, t])
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const tabsRef = useScrollActiveTabIntoView(activeTabId)

  /** applySqlResult 处理 SQL 执行返回值。 */
  const applySqlResult = useCallback((res: unknown, sql: string) => {
    if (res && typeof res === 'object' && isBatchResult(res as SqlResult)) {
      const batch = res as SQLBatchResult
      setSqlResult(batch)
      setLastQuery(null)
      const ok = batch.items.filter((i) => !i.error).length
      setStatusMessage(t('database.batchDone', { ok, total: batch.items.length }))
      return
    }
    if (res && typeof res === 'object' && isQueryPage(res as SqlResult)) {
      const page = res as QueryPage
      setSqlResult(page)
      setLastQuery({ sql, page })
      setStatusMessage(t('database.queryDone', { elapsed: page.elapsedMs, total: page.total }))
      return
    }
    setSqlResult(res as ExecuteResult)
    setLastQuery(null)
    setStatusMessage(t('database.executeDone'))
  }, [setStatusMessage])

  /** applyNotebookSql 将笔记本 SQL 填入已有查询标签（避免重复开标签）。 */
  const applyNotebookSql = useCallback(
    (sql: string) => {
      const state = useAppStore.getState()
      const sqlTab =
        state.tabs.find((t) => t.id === state.activeTabId && t.kind === 'sql') ??
        state.tabs.find((t) => t.kind === 'sql')
      if (sqlTab) {
        updateSqlTab(sqlTab.id, sql)
        setActiveTabId(sqlTab.id)
        return
      }
      addTab({ id: `sql-nb-${Date.now()}`, kind: 'sql', title: t('database.notebookTab'), sql })
    },
    [updateSqlTab, setActiveTabId, addTab]
  )

  /** executeSqlNow 使用指定会话执行 SQL（不依赖 React session 闭包）。 */
  const executeSqlNow = useCallback(
    async (sessionInfo: SessionInfo, sql: string) => {
      if (!sql.trim()) return
      setBottomTab('result')
      setStatusMessage(t('database.executing'))
      try {
        const res = await api.executeSQL(sessionInfo.sessionId, sessionInfo.database, sql)
        applySqlResult(res, sql)
        setHistory(await api.listQueryHistory(sessionInfo.connectionId, 30))
      } catch (e) {
        setSqlResult(null)
        setLastQuery(null)
        setStatusMessage((e as Error).message)
        setBottomTab('message')
      }
    },
    [applySqlResult, setStatusMessage]
  )

  /** fulfillPendingSql 处理来自笔记本的 SQL 填入与执行。 */
  const fulfillPendingSql = useCallback(
    async (sessionInfo: SessionInfo) => {
      const pending = pendingSql.current
      if (!pending) return
      pendingSql.current = null
      applyNotebookSql(pending.sql)
      if (pending.run) {
        await executeSqlNow(sessionInfo, pending.sql)
      } else {
        setStatusMessage(t('database.sqlFilled'))
      }
    },
    [applyNotebookSql, executeSqlNow, setStatusMessage]
  )

  const connect = useCallback(
    async (connId: string, opts?: { force?: boolean }) => {
      let list = useAppStore.getState().connections
      if (!list.length) {
        list = await api.listConnections()
        setConnections(list)
      }
      const conn = list.find((c) => c.id === connId)
      if (!conn) {
        pendingSql.current = null
        setStatusMessage(t('database.connNotFound'))
        return
      }
      const currentSession = useAppStore.getState().session
      const sameConn = currentSession?.connectionId === connId
      if (sameConn && !opts?.force) {
        await fulfillPendingSql(currentSession)
        return
      }
      const keepDatabase =
        opts?.force && sameConn ? (currentSession?.database ?? '') : ''
      if (currentSession) {
        try {
          await api.closeSession(currentSession.sessionId)
        } catch {
          /* ignore */
        }
        setSession(null)
        setObjectTree([])
      }
      setStatusMessage(opts?.force ? t('database.reconnecting') : t('database.connecting'))
      try {
        const info = await api.openSession(connId, keepDatabase)
        setSession(info)
        setActiveConnectionId(connId)
        void saveAppSetting(APP_SETTING_KEYS.lastConnectionId, connId)
        setStatusMessage(
          opts?.force
            ? t('database.reconnected', { name: conn.name })
            : t('database.connected', { name: conn.name }),
        )
        const [tree, history] = await Promise.all([
          api.getObjectTree(info.sessionId),
          api.listQueryHistory(connId, 30),
        ])
        setObjectTree(tree)
        setTreeRefreshNonce((n) => n + 1)
        setHistory(history)
        await fulfillPendingSql(info)
      } catch (e) {
        pendingSql.current = null
        setStatusMessage((e as Error).message)
      }
    },
    [
      setConnections,
      setSession,
      setActiveConnectionId,
      setObjectTree,
      setHistory,
      setStatusMessage,
      fulfillPendingSql,
      t,
    ],
  )

  /** reconnect 关闭并重开当前（或指定）连接，拿到最新库表元数据。 */
  const reconnect = useCallback(
    async (connId?: string) => {
      const current = useAppStore.getState().session
      const targetId = connId ?? current?.connectionId ?? activeConnectionId
      if (!targetId) {
        setStatusMessage(t('database.connectFirst'))
        return
      }
      await connect(targetId, { force: true })
    },
    [activeConnectionId, connect, setStatusMessage, t],
  )

  /** onDatabaseCommand 处理 database_open 命令。 */
  const onDatabaseCommand = useCallback(
    (cmd: { payload: Record<string, unknown> }) => {
      const connectionId = payloadStr(cmd.payload, 'connectionId')
      const initialSql = payloadStr(cmd.payload, 'initialSql')
      const runSql = payloadBool(cmd.payload, 'runSql')
      const connectionDraft = cmd.payload.connectionDraft as ConnectionDraft | undefined
      if (connectionId) {
        const conn = useAppStore.getState().connections.find((c) => c.id === connectionId)
        const sql = initialSql?.trim() ?? ''
        pendingSql.current = sql ? { sql, run: Boolean(runSql) } : null
        restoredConnection.current = true
        if (sql && runSql) {
          setStatusMessage(t('database.openingRunSql', { name: conn?.name ?? t('products.database.label') }))
        } else if (sql) {
          setStatusMessage(t('database.openingFillSql', { name: conn?.name ?? t('products.database.label') }))
        } else {
          setStatusMessage(t('database.opening', { name: conn?.name ?? t('products.database.label') }))
        }
        void connect(connectionId)
        return
      }
      if (!connectionDraft) return
      setEditingConn({
        id: '',
        name: connectionDraft.name ?? '',
        group: connectionDraft.group ?? 'Docker',
        dbType: connectionDraft.dbType ?? 'mysql',
        host: connectionDraft.host ?? '127.0.0.1',
        port: connectionDraft.port ?? 3306,
        user: connectionDraft.user ?? 'root',
        password: connectionDraft.password ?? '',
        database: connectionDraft.database ?? '',
        charset: connectionDraft.charset ?? 'utf8mb4',
        sshEnabled: Boolean(connectionDraft.sshEnabled),
        sshHostId: connectionDraft.sshHostId ?? '',
        sshHost: '',
        sshPort: 22,
        sshUser: '',
        sshKeyPath: '',
        sshPassword: '',
        createdAt: 0,
        updatedAt: 0,
      })
      setConnModalOpen(true)
      setStatusMessage(
        connectionDraft.password
          ? t('database.dockerPwdFilled')
          : t('database.dockerConnDraft'),
      )
    },
    [connect, setStatusMessage, t]
  )

  useWorkbenchCommand(Capability.DatabaseOpen, onDatabaseCommand)

  const selectDatabase = useCallback(
    async (database: string) => {
      if (!session || !database) return
      try {
        const info = await api.setDatabase(session.sessionId, database)
        setSession(info)
        setTreeRefreshNonce((n) => n + 1)
        setStatusMessage(t('database.databaseSelected', { name: database }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    },
    [session, setSession, setStatusMessage, t]
  )

  const disconnect = async () => {
    if (session) await api.closeSession(session.sessionId)
    setSession(null)
    setObjectTree([])
    setActiveConnectionId(null)
    setStatusMessage(t('database.disconnected'))
  }

  /** confirmDeleteConnection 删除连接（若正在使用则先断开）。 */
  const confirmDeleteConnection = async () => {
    const target = deleteConnTarget
    if (!target) return
    setDeleteConnTarget(null)
    try {
      if (session?.connectionId === target.id) {
        await api.closeSession(session.sessionId)
        setSession(null)
        setObjectTree([])
        setHistory([])
      }
      await api.deleteConnection(target.id)
      if (activeConnectionId === target.id) setActiveConnectionId(null)
      await refreshConnections()
      setStatusMessage(t('database.connectionDeleted', { name: target.name }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  useEffect(() => {
    if (restoredConnection.current || !activeConnectionId || session || pendingSql.current) return
    const conn = connectionList.find((c) => c.id === activeConnectionId)
    if (!conn) return
    restoredConnection.current = true
    void connect(activeConnectionId)
  }, [connectionList, activeConnectionId, session, connect])

  /** getRunSQL 获取当前待执行 SQL。 */
  const getRunSQL = useCallback(() => {
    if (activeTab?.kind === 'sql') {
      return sqlEditorRef.current?.getRunSQL() ?? activeTab.sql
    }
    return ''
  }, [activeTab])

  const runSqlText = useCallback(
    async (sql: string) => {
      if (!session || !sql.trim()) return
      if (!session.database) {
        setStatusMessage(t('database.selectDatabaseFirst'))
        setBottomTab('message')
        return
      }
      setBottomTab('result')
      setStatusMessage(t('database.executing'))
      try {
        const res = await api.executeSQL(session.sessionId, session.database, sql)
        applySqlResult(res, sql)
        setHistory(await api.listQueryHistory(session.connectionId, 30))
      } catch (e) {
        setSqlResult(null)
        setLastQuery(null)
        setStatusMessage((e as Error).message)
        setBottomTab('message')
      }
    },
    [session, applySqlResult, setStatusMessage]
  )

  const runSql = useCallback(async () => {
    if (!session || !activeTab || activeTab.kind !== 'sql') return
    await runSqlText(getRunSQL())
  }, [session, activeTab, getRunSQL, runSqlText])

  /** runExplain 执行 EXPLAIN 分析。 */
  const runExplain = useCallback(async () => {
    if (!session || !activeTab || activeTab.kind !== 'sql') return
    const sql = getRunSQL().trim()
    if (!sql) return
    const upper = sql.toUpperCase()
    const explainSql = upper.startsWith('EXPLAIN') ? sql : `EXPLAIN ${sql}`
    await runSqlText(explainSql)
  }, [session, activeTab, getRunSQL, runSqlText])

  /** loadQueryPage 加载查询结果指定页。 */
  const loadQueryPage = useCallback(
    async (page: number) => {
      if (!session || !lastQuery) return
      setResultLoading(true)
      try {
        const pageRes = await api.querySQLPage(
          session.sessionId,
          session.database,
          lastQuery.sql,
          page,
          lastQuery.page.pageSize || 200
        )
        setSqlResult(pageRes)
        setLastQuery({ sql: lastQuery.sql, page: pageRes })
      } catch (e) {
        setStatusMessage((e as Error).message)
      } finally {
        setResultLoading(false)
      }
    },
    [session, lastQuery]
  )

  const openTableTab = async (database: string, table: string) => {
    const sess = useAppStore.getState().session
    if (sess && sess.database !== database) {
      try {
        setSession(await api.setDatabase(sess.sessionId, database))
      } catch (e) {
        setStatusMessage((e as Error).message)
        return
      }
    }
    const id = `table-${database}-${table}`
    if (!useAppStore.getState().tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'table', title: table, database, table })
    } else {
      setActiveTabId(id)
    }
  }

  const openCreateTableTab = (database: string) => {
    const id = `design-new-${database}`
    if (!tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'design', title: t('database.newTableTab', { database }), database, mode: 'create' })
    } else {
      setActiveTabId(id)
    }
  }

  const openDesignTableTab = (database: string, table: string) => {
    const id = `design-${database}-${table}`
    if (!tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'design', title: t('database.designTab', { table }), database, mode: 'alter', table })
    } else {
      setActiveTabId(id)
    }
  }

  /** tableTabIds 返回与表关联的 Tab id。 */
  const tableTabIds = (database: string, table: string) => [
    `table-${database}-${table}`,
    `design-${database}-${table}`,
    `ddl-${database}-${table}`,
    `idx-${database}-${table}`,
  ]

  /** closeTabsForTable 关闭与表相关的 Tab。 */
  const closeTabsForTable = (database: string, table: string) => {
    const removeIds = new Set(tableTabIds(database, table))
    for (const id of removeIds) clearDesignDraft(id)
    const next = tabs.filter((t) => !removeIds.has(t.id))
    if (next.length === tabs.length) return
    useAppStore.getState().setTabs(
      next.length ? next : [{ id: 'sql-1', kind: 'sql', title: t('database.untitledQuery'), sql: defaultUntitledSql() }]
    )
    if (activeTabId && removeIds.has(activeTabId)) {
      setActiveTabId((next[0] || { id: 'sql-1' }).id)
    }
  }

  /** handleTableCreated 新建表成功后切换到设计 Tab。 */
  const handleTableCreated = (createTabId: string, database: string, tableName: string) => {
    const alterTab = {
      id: `design-${database}-${tableName}`,
      kind: 'design' as const,
      title: t('database.designTab', { table: tableName }),
      database,
      mode: 'alter' as const,
      table: tableName,
    }
    const exists = tabs.find((t) => t.id === alterTab.id)
    if (exists) {
      clearDesignDraft(createTabId)
      const next = tabs.filter((t) => t.id !== createTabId)
      useAppStore.getState().setTabs(next)
      setActiveTabId(alterTab.id)
      return
    }
    replaceTab(createTabId, alterTab)
  }

  /** runTableDDL 执行表级 DDL 并刷新对象树。 */
  const runTableDDL = async (sql: string, okMessage: string) => {
    if (!session) return false
    setStatusMessage(t('database.executing'))
    try {
      await api.executeSQL(session.sessionId, session.database, sql)
      await reloadObjectTree(session.sessionId)
      setStatusMessage(okMessage)
      return true
    } catch (e) {
      setStatusMessage((e as Error).message)
      return false
    }
  }

  const truncateTable = (database: string, table: string) => {
    if (!session) return
    setDdlConfirm({ type: 'truncate', database, table })
  }

  const dropTable = (database: string, table: string) => {
    if (!session) return
    setDdlConfirm({ type: 'drop', database, table })
  }

  const dropDatabase = (database: string) => {
    if (!session || !canCreateDatabase) return
    setDdlConfirm({ type: 'drop-database', database })
  }

  /** closeTabsForDatabase 关闭该库下全部相关 Tab。 */
  const closeTabsForDatabase = (database: string) => {
    const belongs = (t: (typeof tabs)[number]) =>
      (t.kind === 'table' || t.kind === 'design' || t.kind === 'ddl') && t.database === database
    const next = tabs.filter((t) => !belongs(t))
    if (next.length === tabs.length) return
    for (const t of tabs) {
      if (belongs(t) && t.id.startsWith('design-')) clearDesignDraft(t.id)
    }
    useAppStore.getState().setTabs(
      next.length ? next : [{ id: 'sql-1', kind: 'sql', title: t('database.untitledQuery'), sql: defaultUntitledSql() }],
    )
    if (activeTab && belongs(activeTab)) {
      setActiveTabId((next[0] || { id: 'sql-1' }).id)
    }
  }

  const confirmTableDDL = async () => {
    if (!session || !ddlConfirm) return
    const confirm = ddlConfirm
    setDdlConfirm(null)
    if (confirm.type === 'drop-database') {
      try {
        await api.dropDatabase(session.sessionId, confirm.database)
        closeTabsForDatabase(confirm.database)
        if (session.database === confirm.database) {
          setSession({ ...session, database: '' })
        }
        await reloadObjectTree(session.sessionId)
        setStatusMessage(t('database.databaseDropped', { name: confirm.database }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
      return
    }
    const { type, database, table } = confirm
    if (type === 'truncate') {
      const ok = await runTableDDL(
        `TRUNCATE TABLE \`${database}\`.\`${table}\``,
        t('database.tableTruncated', { table })
      )
      if (ok && activeTab?.kind === 'table' && activeTab.database === database && activeTab.table === table) {
        setActiveTabId(activeTab.id)
      }
      return
    }
    const ok = await runTableDDL(
      `DROP TABLE \`${database}\`.\`${table}\``,
      t('database.tableDropped', { table })
    )
    if (ok) closeTabsForTable(database, table)
  }

  const exportTableSQL = async (database: string, table: string) => {
    if (!session) return
    setExportMenuOpen(false)
    try {
      await sqlExport.exportTableSQL(session.sessionId, database, table, {
        exporting: t('database.exportingSql'),
        exported: (path) => t('database.exported', { path }),
        cancelled: t('database.exportCancelled'),
      })
    } catch {
      /* 状态已由 hook 写入 */
    }
  }

  const exportDatabaseSQL = async (database: string) => {
    if (!session || !database) return
    setExportMenuOpen(false)
    try {
      await sqlExport.exportDatabaseSQL(session.sessionId, database, {
        exporting: t('database.exportingSql'),
        exported: (path) => t('database.exported', { path }),
        cancelled: t('database.exportCancelled'),
      })
    } catch {
      /* 状态已由 hook 写入 */
    }
  }

  const showDDL = async (database: string, table: string) => {
    if (!session) return
    try {
      const ddl = await api.getTableDDL(session.sessionId, database, table)
      const id = `ddl-${database}-${table}`
      if (!tabs.find((t) => t.id === id)) {
        addTab({ id, kind: 'ddl', title: `DDL · ${table}`, content: ddl, database, editable: true })
      } else {
        setActiveTabId(id)
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const showIndexes = async (database: string, table: string) => {
    if (!session) return
    try {
      const indexes: IndexMeta[] = await api.listIndexes(session.sessionId, database, table)
      const lines = indexes.length
        ? indexes.map(
            (idx) =>
              `${idx.name}\t${idx.column}\t${idx.nonUnique ? 'NON_UNIQUE' : 'UNIQUE'}\t${idx.indexType}\t#${idx.seqInIndex}`
          )
        : ['（无索引）']
      const content = `-- ${database}.${table} 索引\n${lines.join('\n')}\n`
      const id = `idx-${database}-${table}`
      if (!tabs.find((t) => t.id === id)) {
        addTab({ id, kind: 'ddl', title: t('database.indexTab', { table }), content, editable: false })
      } else {
        setActiveTabId(id)
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const exportResult = async (columns: string[]) => {
    if (!lastQuery) return
    const { headers, rows } = queryPageToExport(lastQuery.page, columns)
    const path = await api.exportCSV({ fileName: 'query_result.csv', headers, rows })
    if (path) setStatusMessage(t('database.exported', { path }))
  }

  const exportResultExcel = async (columns: string[]) => {
    if (!lastQuery) return
    const { headers, rows } = queryPageToExport(lastQuery.page, columns)
    const path = await api.exportExcel({ fileName: 'query_result.xlsx', headers, rows })
    if (path) setStatusMessage(t('database.exported', { path }))
  }

  const newSqlTab = () => {
    addTab({ id: `sql-${Date.now()}`, kind: 'sql', title: t('database.untitledQuery'), sql: defaultUntitledSql() })
  }

  const closeTab = (tabId: string) => {
    clearDesignDraft(tabId)
    const next = tabs.filter((x) => x.id !== tabId)
    useAppStore.getState().setTabs(
      next.length ? next : [{ id: 'sql-1', kind: 'sql', title: t('database.untitledQuery'), sql: defaultUntitledSql() }]
    )
    if (activeTabId === tabId) setActiveTabId((next[0] || { id: 'sql-1' }).id)
  }

  /** closeOtherTabs 关闭除指定 Tab 外的全部标签。 */
  const closeOtherTabs = (keepId: string) => {
    for (const tab of tabs) {
      if (tab.id !== keepId) clearDesignDraft(tab.id)
    }
    const next = tabs.filter((x) => x.id === keepId)
    useAppStore.getState().setTabs(next)
    setActiveTabId(keepId)
  }

  /** closeAllTabs 关闭全部标签，保留一个空查询。 */
  const closeAllTabs = () => {
    for (const tab of tabs) clearDesignDraft(tab.id)
    const fresh = { id: `sql-${Date.now()}`, kind: 'sql' as const, title: t('database.untitledQuery'), sql: defaultUntitledSql() }
    useAppStore.getState().setTabs([fresh])
    setActiveTabId(fresh.id)
  }

  const openConnModal = (conn?: Connection) => {
    setEditingConn(conn ?? null)
    setConnModalOpen(true)
  }

  const openDdlTab = (sql: string, title: string, database?: string) => {
    const id = `ddl-new-${Date.now()}`
    addTab({
      id,
      kind: 'ddl',
      title,
      content: sql,
      database: database || session?.database,
      editable: true,
    })
  }

  const runDdlTab = async () => {
    if (!session || activeTab?.kind !== 'ddl' || !activeTab.editable) return
    await runSqlText(activeTab.content)
  }

  const runSqlFile = async (database?: string) => {
    if (!session) return
    const targetDb = database ?? session.database ?? ''
    setBottomTab('result')
    setStatusMessage(t('database.importingSqlFile'))
    try {
      const res = await api.executeSQLFile(session.sessionId, targetDb)
      if (res) applySqlResult(res, '-- SQL 文件')
      await reloadObjectTree(session.sessionId)
      setHistory(await api.listQueryHistory(session.connectionId, 30))
      setStatusMessage(t('database.importedSqlFile'))
    } catch (e) {
      setStatusMessage((e as Error).message)
      setBottomTab('message')
    }
  }

  const createDatabase = async (name: string, charset: string, collation: string) => {
    if (!session) return
    setCreateDbOpen(false)
    try {
      await api.createDatabase(session.sessionId, name, charset, collation)
      await reloadObjectTree(session.sessionId)
      await selectDatabase(name)
      setStatusMessage(t('database.databaseCreated', { name }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** openLinkedProduct 从当前数据库连接跳转到终端或 SFTP。 */
  const openLinkedProduct = async (action: 'terminal' | 'sftp') => {
    if (!session) return
    try {
      setStatusMessage(t('database.resolvingSsh'))
      const host = await api.ensureSSHHostFromConnection(session.connectionId)
      if (action === 'terminal') openTerminal({ hostId: host.id }, 'database')
      else openSftp({ hostId: host.id }, 'database')
      setStatusMessage(
        action === 'terminal'
          ? t('database.openingTerminal', { name: host.name })
          : t('database.openingSftp', { name: host.name })
      )
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** openNotebookFromConnection 从当前连接创建笔记本笔记。 */
  const openNotebookFromConnection = () => {
    if (!session) return
    openNotebook({ connectionId: session.connectionId }, 'database')
    setStatusMessage(t('database.creatingNote'))
  }

  const connLabel =
    session && activeConn
      ? `${activeConn.name} · ${activeConn.host}:${activeConn.port}`
      : t('database.notConnected')
  const sshLinked = Boolean(session && activeConn?.sshEnabled)

  return (
    <div className="product-workbench database-workbench">
      <div className="product-toolbar database-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" title={t('database.newConnection')} {...pressProps(() => openConnModal())}>
            <IconPlus size={13} />
            <span>{t('database.connection')}</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!activeConn}
            title={t('database.editConnection')}
            {...pressProps(() => activeConn && openConnModal(activeConn), { disabled: !activeConn })}
          >
            <IconEdit size={13} />
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome wn-btn-danger"
            disabled={!activeConn}
            title={t('database.deleteConnection')}
            {...pressProps(() => activeConn && setDeleteConnTarget(activeConn), { disabled: !activeConn })}
          >
            <IconTrash size={13} />
          </button>
          <span className="chrome-vrule" />
          <button type="button" className="wn-btn wn-btn-chrome" title={t('database.newQuery')} {...pressProps(newSqlTab)}>
            <IconSql size={13} />
            <span>{t('database.newQuery')}</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome wn-btn-run"
            disabled={!session || activeTab?.kind !== 'sql'}
            title={t('database.runTitle')}
            {...pressProps(runSql, { disabled: !session || activeTab?.kind !== 'sql' })}
          >
            <IconPlay size={12} />
            <span>{t('database.run')}</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!session || activeTab?.kind !== 'sql'}
            title={t('database.explain')}
            {...pressProps(runExplain, { disabled: !session || activeTab?.kind !== 'sql' })}
          >
            <IconExplain size={13} />
            <span>EXPLAIN</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!session || isRedis}
            title={t('database.importSqlHint')}
            {...pressProps(() => void runSqlFile(), { disabled: !session || isRedis })}
          >
            <IconImportSql size={13} />
            <span>{t('database.importSql')}</span>
          </button>
          <div className="shell-locale-menu" ref={exportMenuRef}>
            <button
              type="button"
              className="wn-btn wn-btn-chrome"
              disabled={!session || isRedis || sqlExport.exporting}
              title={t('database.exportSqlHint')}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              {...pressProps(() => setExportMenuOpen((v) => !v), { disabled: !session || isRedis || sqlExport.exporting })}
            >
              <IconDownload size={13} />
              <span>{t('database.exportSql')}</span>
            </button>
            {exportMenuOpen && (
              <div className="shell-locale-dropdown" role="menu" style={{ left: 0, right: 'auto', minWidth: 168 }}>
                <button
                  type="button"
                  className="shell-locale-item"
                  disabled={!session?.database}
                  {...pressProps(() => {
                    if (session?.database) void exportDatabaseSQL(session.database)
                  }, { disabled: !session?.database })}
                >
                  {t('database.exportCurrentDb')}
                </button>
                <button
                  type="button"
                  className="shell-locale-item"
                  disabled={!(activeTab?.kind === 'table' && activeTab.database && activeTab.table)}
                  {...pressProps(() => {
                    if (activeTab?.kind === 'table' && activeTab.database && activeTab.table) {
                      void exportTableSQL(activeTab.database, activeTab.table)
                    }
                  }, { disabled: !(activeTab?.kind === 'table' && activeTab.database && activeTab.table) })}
                >
                  {t('database.exportCurrentTable')}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!session}
            title={t('database.reconnect')}
            {...pressProps(() => void reconnect(), { disabled: !session })}
          >
            <IconRefresh size={13} />
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!session}
            title={t('database.disconnect')}
            {...pressProps(disconnect, { disabled: !session })}
          >
            <IconDisconnect size={13} />
          </button>
          {session && (
            <>
              <span className="chrome-vrule" />
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('database.saveNotebook')}
                {...pressProps(openNotebookFromConnection)}
              >
                <IconNotebook size={13} />
                <span>{t('database.notebook')}</span>
              </button>
            </>
          )}
          {sshLinked && (
            <>
              <span className="chrome-vrule" />
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('database.sshTerminal')}
                {...pressProps(() => void openLinkedProduct('terminal'))}
              >
                <IconTerminal size={13} />
                <span>{t('database.sshTerminal')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('database.sftp')}
                {...pressProps(() => void openLinkedProduct('sftp'))}
              >
                <IconFolder size={13} />
                <span>{t('database.sftp')}</span>
              </button>
            </>
          )}
        </nav>
        <span className="chrome-spacer" />
        {sqlExport.progress && sqlExport.progress.state === 'running' && (
          <div className="db-export-progress" title={sqlExport.progress.message}>
            <div className="db-export-progress-track">
              <div
                className="db-export-progress-fill"
                style={{
                  width: `${
                    sqlExport.progress.total > 0
                      ? Math.min(100, Math.round((sqlExport.progress.done / sqlExport.progress.total) * 100))
                      : 8
                  }%`,
                }}
              />
            </div>
            <span className="db-export-progress-label">
              {sqlExport.progress.total > 0
                ? t('database.exportProgress', {
                    current: sqlExport.progress.done,
                    total: sqlExport.progress.total,
                    name: sqlExport.progress.table || sqlExport.progress.database || sqlExport.progress.message,
                  })
                : t('database.exportingSql')}
            </span>
            <button
              type="button"
              className="wn-btn wn-btn-chrome wn-btn-sm"
              {...pressProps(() => sqlExport.cancel())}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}
        <div className="product-toolbar-status" title={connLabel}>
          <span className={`status-dot ${session ? 'online' : ''}`} />
          <span>{connLabel}</span>
        </div>
      </div>

      <ProductLayout
        storageKey={DB_SIDEBAR_WIDTH_KEY}
        resizeTitle={t('common.resizeWidth')}
        defaultWidth={400}
        minWidth={200}
        maxWidth={720}
        width={databaseSidebarWidth}
        onResizeStart={onDatabaseSidebarResizeStart}
        sidebar={
          <SidebarStack
            storageKey="database_sidebar_stack"
            resizeTitle={t('common.resizeHeight')}
            sections={[
              {
                id: 'explorer',
                flex: true,
                content: (
                  <SidebarColumns
                    storageKey={DB_COLUMNS_KEY}
                    resizeTitle={t('common.resizeWidth')}
                    collapseTitle={t('common.collapsePane')}
                    expandTitle={t('common.expandPane')}
                    className="database-explorer-columns"
                    collapsed={explorerCollapsed}
                    onCollapsedChange={applyExplorerCollapsed}
                    sections={[
                      {
                        id: 'connections',
                        defaultSize: 168,
                        min: 120,
                        max: 320,
                        collapsible: true,
                        railLabel: t('database.connectionsRail'),
                        collapseLabel: t('common.collapsePane'),
                        expandLabel: t('database.expandConnections'),
                        content: (
                          <section className="sidebar-section connections">
                            <div className="sidebar-header">
                              <PaneCollapseButton
                                title={t('database.collapseConnections')}
                                onToggle={toggleConnectionsPane}
                              />
                              <span className="sidebar-header-title">{t('database.connections')}</span>
                              <div className="sidebar-header-actions">
                                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('database.newConnection')} {...pressProps(() => openConnModal())}>
                                  <IconPlus size={14} />
                                </button>
                              </div>
                            </div>
                            <div className="sidebar-body connections-body">
                              {connectionList.length === 0 ? (
                                <EmptyState
                                  variant="inline"
                                  title={t('database.emptyConnectionsGeneric')}
                                  actions={[
                                    { label: t('database.newConnection'), onPress: () => openConnModal(), primary: true },
                                  ]}
                                />
                              ) : (
                                groupedConnections.map(([group, list]) => (
                                  <div key={group} className="conn-group">
                                    <div className="conn-group-title">{group}</div>
                                    <ul className="conn-list">
                                      {list.map((c) => (
                                        <li
                                          key={c.id}
                                          role="button"
                                          tabIndex={0}
                                          className={`conn-item ${activeConnectionId === c.id ? 'active' : ''} ${session?.connectionId === c.id ? 'connected' : ''}`}
                                          {...pressProps(() => connect(c.id))}
                                          onDoubleClick={() => void reconnect(c.id)}
                                          onContextMenu={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setConnCtxMenu({ x: e.clientX, y: e.clientY, conn: c })
                                          }}
                                          title={
                                            session?.connectionId === c.id
                                              ? t('database.reconnectHint')
                                              : undefined
                                          }
                                        >
                                          <span className="conn-dot" />
                                          <div className="conn-meta">
                                            <span className="conn-name">
                                              {c.name}
                                              {c.sshEnabled && <span className="conn-ssh-tag">SSH</span>}
                                            </span>
                                            <span className="conn-host">
                                              <span className="conn-db-type">{c.dbType}</span>
                                              {c.sshEnabled && c.sshHost ? `${c.sshHost} → ` : ''}
                                              {c.host}:{c.port}
                                            </span>
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))
                              )}
                            </div>
                          </section>
                        ),
                      },
                      {
                        id: 'objects',
                        flex: true,
                        content: (
                          <section className="sidebar-section objects">
                            <div className="sidebar-header">
                              <span>{t('database.objectBrowser')}</span>
                              <div className="sidebar-header-actions">
                                {canCreateDatabase && session && (
                                  <button
                                    type="button"
                                    className="wn-btn wn-btn-icon wn-btn-sm"
                                    title={t('database.createDatabase')}
                                    {...pressProps(() => setCreateDbOpen(true))}
                                  >
                                    <IconPlus size={14} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="wn-btn wn-btn-icon wn-btn-sm"
                                  disabled={!session}
                                  title={t('common.refresh')}
                                  {...pressProps(() => void refreshObjectTree(), { disabled: !session })}
                                >
                                  <IconRefresh size={14} />
                                </button>
                              </div>
                            </div>
                            {session && (
                              <div className="sidebar-filter">
                                <input
                                  className="wn-input wn-input-sm"
                                  placeholder={t('database.filterPlaceholder')}
                                  value={treeFilter}
                                  onChange={(e) => setTreeFilter(e.target.value)}
                                />
                              </div>
                            )}
                            <div className="sidebar-body">
                              {session ? (
                                <ObjectTree
                                  sessionId={session.sessionId}
                                  nodes={treeNodes}
                                  filter={treeFilter}
                                  selectedDatabase={session.database || undefined}
                                  selectedTable={
                                    activeTab?.kind === 'table'
                                      ? activeTab.table
                                      : activeTab?.kind === 'design'
                                        ? activeTab.table
                                        : undefined
                                  }
                                  refreshNonce={treeRefreshNonce}
                                  canCreateTable={canCreateTable}
                                  canDesignTable={canDesignTable}
                                  isRedis={isRedis}
                                  dbType={activeConn?.dbType}
                                  onTableDoubleClick={openTableTab}
                                  onDatabaseSelect={(db) => void selectDatabase(db)}
                                  onShowDDL={showDDL}
                                  onShowIndexes={showIndexes}
                                  onNewTable={openCreateTableTab}
                                  onDesignTable={openDesignTableTab}
                                  onTruncateTable={truncateTable}
                                  onDropTable={dropTable}
                                  onDropDatabase={canCreateDatabase ? dropDatabase : undefined}
                                  onExportTableSQL={exportTableSQL}
                                  onExportDatabaseSQL={exportDatabaseSQL}
                                  onImportSQL={(db) => void runSqlFile(db)}
                                  onCreateDatabase={canCreateDatabase ? () => setCreateDbOpen(true) : undefined}
                                />
                              ) : (
                                <div className="empty-hint">{t('database.connectToBrowse')}</div>
                              )}
                            </div>
                          </section>
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                id: 'history',
                defaultSize: 120,
                min: 72,
                max: 320,
                content: (
                  <section className="sidebar-section history">
                    <div className="sidebar-header">
                      <span>{t('database.queryHistory')}</span>
                    </div>
                    <div className="sidebar-body">
                      {history.length === 0 ? (
                        <div className="empty-hint" style={{ padding: '12px 8px' }}>
                          {t('database.noHistory')}
                        </div>
                      ) : (
                        history.map((h) => (
                          <div
                            key={h.id}
                            className={`history-item ${h.success ? '' : 'failed'}`}
                            title={h.sql}
                            {...pressProps(() =>
                              addTab({ id: `sql-h-${h.id}`, kind: 'sql', title: t('database.historyQuery'), sql: h.sql }),
                            )}
                          >
                            {h.sql.slice(0, 50)}
                            {h.sql.length > 50 ? '…' : ''}
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                ),
              },
            ]}
          />
        }
      >
        <main className="app-main database-main">
          <div className="editor-chrome database-editor-chrome">
            <div className="wn-tabs" ref={tabsRef}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-tab-id={tab.id}
                  className={`wn-tab wn-tab-${tab.kind} ${tab.id === activeTabId ? 'active' : ''}`}
                  {...pressProps(() => setActiveTabId(tab.id))}
                  onContextMenu={(e) => openTabContextMenu(e, tab.id, setTabCtxMenu, setActiveTabId)}
                >
                  <span className="tab-dot" />
                  <span className="tab-title">{localizeWorkTabTitle(tab.title, t)}</span>
                  <span
                    className="wn-tab-close"
                    {...pressProps(() => closeTab(tab.id), { stop: true })}
                  >
                    ×
                  </span>
                </button>
              ))}
              <button type="button" className="wn-tab wn-tab-add" {...pressProps(newSqlTab)} title={t('database.newQuery')}>
                +
              </button>
            </div>
            {session && (
              <div className="query-bar database-query-bar">
                <label>{t('database.database')}</label>
                <Select
                  value={session.database}
                  placeholder={t('database.selectDatabase')}
                  options={[
                    { value: '', label: t('database.selectDatabase') },
                    ...treeNodes.map((db) => ({ value: db.label, label: db.label })),
                  ]}
                  onChange={(v) => void selectDatabase(v)}
                />
              </div>
            )}
          </div>

          <div className="workspace">
            {!activeTab &&
              (session ? (
                <EmptyState
                  title={t('database.emptyWorkspace')}
                  hint={t('database.emptyWorkspaceHint')}
                  actions={[{ label: t('database.newQuery'), onPress: newSqlTab, primary: true }]}
                />
              ) : connectionList.length === 0 ? (
                <EmptyState
                  title={t('database.emptyConnectionsGeneric')}
                  hint={t('database.emptyConnectionsHint')}
                  actions={[{ label: t('database.newConnection'), onPress: () => openConnModal(), primary: true }]}
                />
              ) : (
                <EmptyState
                  title={t('database.connectFirst')}
                  hint={t('database.connectFirstHint')}
                  actions={[
                    {
                      label: t('database.connectAction', { name: connectionList[0].name }),
                      onPress: () => void connect(connectionList[0].id),
                      primary: true,
                    },
                    { label: t('database.newConnection'), onPress: () => openConnModal() },
                  ]}
                />
              ))}
            {activeTab?.kind === 'sql' && (
              <div className="sql-workspace">
                <SqlEditor
                  ref={sqlEditorRef}
                  tabId={activeTab.id}
                  sql={activeTab.sql}
                  onChange={(sql) => updateSqlTab(activeTab.id, sql)}
                  onExecute={runSql}
                />
                <ResizeHandle axis="y" onMouseDown={onResultResizeStart} title={t('common.resizeHeight')} />
                <div className="bottom-panel" style={{ height: resultHeight }}>
                  <div className="bottom-panel-tabs">
                    <button
                      type="button"
                      className={`bottom-panel-tab ${bottomTab === 'result' ? 'active' : ''}`}
                      {...pressProps(() => setBottomTab('result'))}
                    >
                      {t('database.result')}
                    </button>
                    <button
                      type="button"
                      className={`bottom-panel-tab ${bottomTab === 'message' ? 'active' : ''}`}
                      {...pressProps(() => setBottomTab('message'))}
                    >
                      {t('database.message')}
                    </button>
                  </div>
                  <div className="bottom-panel-body">
                    {bottomTab === 'result' ? (
                      <ResultPanel
                        result={sqlResult}
                        message={statusMessage}
                        onExport={lastQuery ? exportResult : undefined}
                        onExportExcel={isMysql && lastQuery ? exportResultExcel : undefined}
                        onPageChange={lastQuery ? loadQueryPage : undefined}
                        loading={resultLoading}
                      />
                    ) : (
                      <div className="empty-hint">{statusMessage}</div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {activeTab?.kind === 'table' && session && activeTab.database && activeTab.table && (
              <TableDataEditor
                key={`${session.sessionId}:${activeTab.database}:${activeTab.table}`}
                sessionId={session.sessionId}
                database={activeTab.database}
                table={activeTab.table}
                excelExport={isMysql}
                onTableMissing={() => {
                  const db = activeTab.database!
                  const tbl = activeTab.table!
                  setStatusMessage(t('database.tableMissingClosed', { table: tbl }))
                  closeTabsForTable(db, tbl)
                }}
              />
            )}
            {activeTab?.kind === 'table' && !session && (
              <div className="pane-empty">
                <span>{t('database.connectFirst')}</span>
              </div>
            )}
            {activeTab?.kind === 'ddl' && (
              <DdlEditor
                tabId={activeTab.id}
                content={activeTab.content}
                editable={activeTab.editable ?? false}
                onChange={(content) => updateDdlTab(activeTab.id, content)}
                onExecute={() => void runDdlTab()}
              />
            )}
            {activeTab?.kind === 'design' && session && (
              <div className="table-workspace">
                <TableDesignEditor
                  tabId={activeTab.id}
                  sessionId={session.sessionId}
                  database={activeTab.database}
                  dbType={
                    activeConn?.dbType ||
                    connectionList.find((c) => c.id === session.connectionId)?.dbType ||
                    'mysql'
                  }
                  mode={activeTab.mode}
                  table={activeTab.table}
                  onSaved={async () => {
                    await reloadObjectTree(session.sessionId)
                  }}
                  onCreated={
                    activeTab.mode === 'create'
                      ? (tableName) => handleTableCreated(activeTab.id, activeTab.database, tableName)
                      : undefined
                  }
                  onStatus={setStatusMessage}
                  onOpenDDL={(sql, title) => openDdlTab(sql, title, activeTab.database)}
                  onTableMissing={
                    activeTab.mode === 'alter' && activeTab.table
                      ? () => {
                          const db = activeTab.database
                          const tbl = activeTab.table!
                          setStatusMessage(t('database.tableMissingClosed', { table: tbl }))
                          closeTabsForTable(db, tbl)
                        }
                      : undefined
                  }
                />
              </div>
            )}
            {activeTab?.kind === 'design' && !session && (
              <div className="pane-empty">
                <span>{t('database.connectFirst')}</span>
              </div>
            )}
          </div>
        </main>
      </ProductLayout>

      {tabCtxMenu && (
        <TabContextMenu
          menu={tabCtxMenu}
          disableCloseOthers={tabs.length <= 1}
          onDismiss={() => setTabCtxMenu(null)}
          onClose={() => closeTab(tabCtxMenu.tabId)}
          onCloseOthers={() => closeOtherTabs(tabCtxMenu.tabId)}
          onCloseAll={closeAllTabs}
        />
      )}
      {connCtxMenu && (
        <ContextMenu
          key={`conn-${connCtxMenu.conn.id}-${connCtxMenu.x}-${connCtxMenu.y}`}
          x={connCtxMenu.x}
          y={connCtxMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const c = connCtxMenu.conn
              setConnCtxMenu(null)
              openAgentDraft({
                mentions: [mentionDatabase(c)],
                message: t('agent.draftDatabase'),
              })
            })}
          >
            {t('agent.sendToAgent')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const c = connCtxMenu.conn
              setConnCtxMenu(null)
              void reconnect(c.id)
            })}
          >
            {t('database.reconnect')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setConnCtxMenu(null)
              openConnModal(connCtxMenu.conn)
            })}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="wn-context-item wn-context-item-danger"
            {...pressProps(() => {
              const c = connCtxMenu.conn
              setConnCtxMenu(null)
              setDeleteConnTarget(c)
            })}
          >
            {t('common.delete')}
          </button>
        </ContextMenu>
      )}

      <ConnectionModal
        open={connModalOpen}
        initial={editingConn}
        onClose={() => setConnModalOpen(false)}
        onSaved={refreshConnections}
      />
      <CreateDatabaseDialog
        open={createDbOpen}
        mysql={isMysql}
        onConfirm={(name, charset, collation) => void createDatabase(name, charset, collation)}
        onCancel={() => setCreateDbOpen(false)}
      />
      <ConfirmDialog
        open={ddlConfirm != null}
        title={
          ddlConfirm?.type === 'drop-database'
            ? t('database.dropDatabaseTitle')
            : ddlConfirm?.type === 'drop'
              ? t('database.dropTableTitle')
              : t('database.truncateTableTitle')
        }
        message={
          ddlConfirm
            ? ddlConfirm.type === 'drop-database'
              ? t('database.dropDatabaseMsg', { database: ddlConfirm.database })
              : ddlConfirm.type === 'drop'
                ? t('database.dropTableMsg', { database: ddlConfirm.database, table: ddlConfirm.table })
                : t('database.truncateTableMsg', { database: ddlConfirm.database, table: ddlConfirm.table })
            : undefined
        }
        confirmLabel={
          ddlConfirm?.type === 'drop' || ddlConfirm?.type === 'drop-database'
            ? t('common.delete')
            : t('database.truncate')
        }
        danger
        onConfirm={() => void confirmTableDDL()}
        onCancel={() => setDdlConfirm(null)}
      />
      <ConfirmDialog
        open={deleteConnTarget != null}
        title={t('database.deleteConnectionTitle')}
        message={
          deleteConnTarget
            ? t('database.deleteConnectionMsg', { name: deleteConnTarget.name })
            : undefined
        }
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void confirmDeleteConnection()}
        onCancel={() => setDeleteConnTarget(null)}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, ExecuteResult, IndexMeta, QueryHistory, QueryPage, SQLBatchResult } from '../../api/types'
import { IconDisconnect, IconEdit, IconPlay, IconPlus, IconSql } from '../../components/Icons'
import { ConnectionModal } from '../../features/connection/ConnectionModal'
import { DdlEditor } from '../../features/ddl/DdlEditor'
import { ObjectTree } from '../../features/explorer/ObjectTree'
import { ResultPanel } from '../../features/sql-editor/ResultPanel'
import { SqlEditor, type SqlEditorHandle } from '../../features/sql-editor/SqlEditor'
import { TableDesignEditor } from '../../features/table-design/TableDesignEditor'
import { TableDataEditor } from '../../features/table-data/TableDataEditor'
import { useAppStore } from '../../stores/appStore'
import { APP_SETTING_KEYS, saveAppSetting } from '../../stores/appPreferences'
import { queryPageToCSV } from '../../utils/queryCsv'

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
    setProductLink,
    productLink,
    addTab,
    replaceTab,
    updateSqlTab,
    updateDdlTab,
    clearDesignDraft,
    statusMessage,
  } = useAppStore()

  const sqlEditorRef = useRef<SqlEditorHandle>(null)
  const [connModalOpen, setConnModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<Connection | null>(null)
  const [sqlResult, setSqlResult] = useState<SqlResult | null>(null)
  const [resultHeight, setResultHeight] = useState(220)
  const [bottomTab, setBottomTab] = useState<'result' | 'message'>('result')
  const [history, setHistory] = useState<QueryHistory[]>([])
  const [lastQuery, setLastQuery] = useState<{ sql: string; page: QueryPage } | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [treeFilter, setTreeFilter] = useState('')
  const restoredConnection = useRef(false)

  useEffect(() => {
    refreshConnections()
  }, [])

  useEffect(() => {
    if (!productLink || productLink.action !== 'database') return
    const draft = productLink.connectionDraft
    setProductLink(null)
    if (!draft) return
    setEditingConn({
      id: '',
      name: draft.name ?? '',
      group: draft.group ?? 'Docker',
      dbType: draft.dbType ?? 'mysql',
      host: draft.host ?? '127.0.0.1',
      port: draft.port ?? 3306,
      user: draft.user ?? 'root',
      password: '',
      database: draft.database ?? '',
      charset: draft.charset ?? 'utf8mb4',
      sshEnabled: Boolean(draft.sshEnabled),
      sshHostId: draft.sshHostId ?? '',
      sshHost: '',
      sshPort: 22,
      sshUser: '',
      sshKeyPath: '',
      sshPassword: '',
      createdAt: 0,
      updatedAt: 0,
    })
    setConnModalOpen(true)
    setActiveProduct('database')
    setStatusMessage('已根据容器生成连接配置，请补全密码后保存并连接')
  }, [productLink, setProductLink, setActiveProduct, setStatusMessage])

  const refreshConnections = async () => {
    try {
      const list = await api.listConnections()
      setConnections(list)
    } catch (e) {
      console.error(e)
      setConnections([])
      setStatusMessage((e as Error).message)
    }
  }

  const refreshObjectTree = async () => {
    if (!session) return
    try {
      setObjectTree(await api.getObjectTree(session.sessionId))
      setStatusMessage('对象树已刷新')
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const connectionList = connections ?? []
  const treeNodes = objectTree ?? []
  const groupedConnections = useMemo(() => {
    const map = new Map<string, Connection[]>()
    for (const c of connectionList) {
      const g = c.group?.trim() || '默认'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(c)
    }
    return [...map.entries()]
  }, [connectionList])
  const activeConn = connectionList.find((c) => c.id === activeConnectionId)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const connect = async (connId: string) => {
    const conn = connectionList.find((c) => c.id === connId)
    if (!conn) return
    if (session?.connectionId === connId) return
    if (session) {
      try {
        await api.closeSession(session.sessionId)
      } catch {
        /* ignore */
      }
    }
    setStatusMessage('正在连接...')
    try {
      const info = await api.openSession(connId, conn.database || '')
      setSession(info)
      setActiveConnectionId(connId)
      void saveAppSetting(APP_SETTING_KEYS.lastConnectionId, connId)
      setObjectTree(await api.getObjectTree(info.sessionId))
      setHistory(await api.listQueryHistory(connId, 30))
      setStatusMessage(`已连接到 ${conn.name}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const disconnect = async () => {
    if (session) await api.closeSession(session.sessionId)
    setSession(null)
    setObjectTree([])
    setActiveConnectionId(null)
    setStatusMessage('已断开连接')
  }

  useEffect(() => {
    if (restoredConnection.current || !activeConnectionId || session) return
    const conn = connectionList.find((c) => c.id === activeConnectionId)
    if (!conn) return
    restoredConnection.current = true
    void connect(activeConnectionId)
  }, [connectionList, activeConnectionId, session])

  /** getRunSQL 获取当前待执行 SQL。 */
  const getRunSQL = useCallback(() => {
    if (activeTab?.kind === 'sql') {
      return sqlEditorRef.current?.getRunSQL() ?? activeTab.sql
    }
    return ''
  }, [activeTab])

  /** applySqlResult 处理 SQL 执行返回值。 */
  const applySqlResult = useCallback((res: unknown, sql: string) => {
    if (res && typeof res === 'object' && isBatchResult(res as SqlResult)) {
      const batch = res as SQLBatchResult
      setSqlResult(batch)
      setLastQuery(null)
      const ok = batch.items.filter((i) => !i.error).length
      setStatusMessage(`批量执行完成 · ${ok}/${batch.items.length} 条成功`)
      return
    }
    if (res && typeof res === 'object' && isQueryPage(res as SqlResult)) {
      const page = res as QueryPage
      setSqlResult(page)
      setLastQuery({ sql, page })
      setStatusMessage(`查询完成 · ${page.elapsedMs} ms · 共 ${page.total} 行`)
      return
    }
    setSqlResult(res as ExecuteResult)
    setLastQuery(null)
    setStatusMessage('执行完成')
  }, [])

  const runSqlText = useCallback(
    async (sql: string) => {
      if (!session || !sql.trim()) return
      setBottomTab('result')
      setStatusMessage('正在执行...')
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
    [session, applySqlResult]
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

  const openTableTab = (database: string, table: string) => {
    const id = `table-${database}-${table}`
    if (!tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'table', title: table, database, table })
    } else {
      setActiveTabId(id)
    }
  }

  const openCreateTableTab = (database: string) => {
    const id = `design-new-${database}`
    if (!tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'design', title: `新建表 · ${database}`, database, mode: 'create' })
    } else {
      setActiveTabId(id)
    }
  }

  const openDesignTableTab = (database: string, table: string) => {
    const id = `design-${database}-${table}`
    if (!tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'design', title: `设计 · ${table}`, database, mode: 'alter', table })
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
      next.length ? next : [{ id: 'sql-1', kind: 'sql', title: '无标题查询', sql: '-- 输入 SQL\nSELECT 1;\n' }]
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
      title: `设计 · ${tableName}`,
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
    setStatusMessage('正在执行...')
    try {
      await api.executeSQL(session.sessionId, session.database, sql)
      setObjectTree(await api.getObjectTree(session.sessionId))
      setStatusMessage(okMessage)
      return true
    } catch (e) {
      setStatusMessage((e as Error).message)
      return false
    }
  }

  const truncateTable = async (database: string, table: string) => {
    if (!session) return
    if (!window.confirm(`确定清空表 ${database}.${table} 的全部数据？\n（TRUNCATE，不可撤销）`)) return
    const ok = await runTableDDL(`TRUNCATE TABLE \`${database}\`.\`${table}\``, `表 ${table} 已清空`)
    if (ok && activeTab?.kind === 'table' && activeTab.database === database && activeTab.table === table) {
      setActiveTabId(activeTab.id)
    }
  }

  const dropTable = async (database: string, table: string) => {
    if (!session) return
    if (!window.confirm(`确定删除表 ${database}.${table}？\n（DROP TABLE，不可撤销）`)) return
    const ok = await runTableDDL(`DROP TABLE \`${database}\`.\`${table}\``, `表 ${table} 已删除`)
    if (ok) closeTabsForTable(database, table)
  }

  const exportTableInsert = async (database: string, table: string) => {
    if (!session) return
    try {
      const path = await api.exportTableInsertSQL(session.sessionId, database, table, 5000)
      if (path) setStatusMessage(`已导出 ${path}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
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
        addTab({ id, kind: 'ddl', title: `索引 · ${table}`, content, editable: false })
      } else {
        setActiveTabId(id)
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const exportResult = async () => {
    if (!lastQuery) return
    const { headers, rows } = queryPageToCSV(lastQuery.page)
    const path = await api.exportCSV({ fileName: 'query_result.csv', headers, rows })
    if (path) setStatusMessage(`已导出 ${path}`)
  }

  const newSqlTab = () => {
    addTab({ id: `sql-${Date.now()}`, kind: 'sql', title: '无标题查询', sql: '-- 输入 SQL\n' })
  }

  const closeTab = (tabId: string) => {
    clearDesignDraft(tabId)
    const next = tabs.filter((x) => x.id !== tabId)
    useAppStore.getState().setTabs(
      next.length ? next : [{ id: 'sql-1', kind: 'sql', title: '无标题查询', sql: '-- 输入 SQL\nSELECT 1;\n' }]
    )
    if (activeTabId === tabId) setActiveTabId((next[0] || { id: 'sql-1' }).id)
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

  const runSqlFile = async () => {
    if (!session) return
    setBottomTab('result')
    setStatusMessage('正在执行 SQL 文件...')
    try {
      const res = await api.executeSQLFile(session.sessionId, session.database)
      if (res) applySqlResult(res, '-- SQL 文件')
      setHistory(await api.listQueryHistory(session.connectionId, 30))
    } catch (e) {
      setStatusMessage((e as Error).message)
      setBottomTab('message')
    }
  }

  const exportConnections = async () => {
    const path = await api.exportConnectionsToFile(false)
    if (path) setStatusMessage(`已导出连接 ${path}`)
  }

  const importConnections = async () => {
    const count = await api.importConnectionsFromFile()
    if (count > 0) {
      await refreshConnections()
      setStatusMessage(`已导入 ${count} 个连接`)
    }
  }

  /** openLinkedProduct 从当前数据库连接跳转到终端或 SFTP。 */
  const openLinkedProduct = async (action: 'terminal' | 'sftp') => {
    if (!session) return
    try {
      setStatusMessage('正在解析 SSH 主机…')
      const host = await api.ensureSSHHostFromConnection(session.connectionId)
      setActiveProduct(action)
      setProductLink({ action, hostId: host.id })
      setStatusMessage(action === 'terminal' ? `正在打开终端 · ${host.name}` : `正在打开 SFTP · ${host.name}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const connLabel = session && activeConn ? `${activeConn.name} · ${activeConn.host}:${activeConn.port}` : '未连接'
  const sshLinked = Boolean(session && activeConn?.sshEnabled)

  return (
    <div className="product-workbench database-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" onClick={() => openConnModal()} title="新建连接">
            <IconPlus size={13} />
            <span>连接</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            onClick={() => activeConn && openConnModal(activeConn)}
            disabled={!activeConn}
            title="编辑连接"
          >
            <IconEdit size={13} />
          </button>
          <span className="chrome-vrule" />
          <button type="button" className="wn-btn wn-btn-chrome" onClick={newSqlTab} title="新建查询">
            <IconSql size={13} />
            <span>查询</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome wn-btn-run"
            onClick={runSql}
            disabled={!session || activeTab?.kind !== 'sql'}
            title="运行 (⌘+Enter)"
          >
            <IconPlay size={12} />
            <span>运行</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            onClick={runExplain}
            disabled={!session || activeTab?.kind !== 'sql'}
            title="EXPLAIN 分析"
          >
            <span>EXPLAIN</span>
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            onClick={() => void runSqlFile()}
            disabled={!session}
            title="执行 SQL 文件"
          >
            <span>SQL 文件</span>
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" onClick={disconnect} disabled={!session} title="断开">
            <IconDisconnect size={13} />
          </button>
          {sshLinked && (
            <>
              <span className="chrome-vrule" />
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                onClick={() => void openLinkedProduct('terminal')}
                title="打开 SSH 终端"
              >
                <span>SSH 终端</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                onClick={() => void openLinkedProduct('sftp')}
                title="打开 SFTP"
              >
                <span>SFTP</span>
              </button>
            </>
          )}
        </nav>
        <span className="chrome-spacer" />
        <div className="product-toolbar-status" title={connLabel}>
          <span className={`status-dot ${session ? 'online' : ''}`} />
          <span>{connLabel}</span>
        </div>
      </div>

      <div className="product-body">
        <aside className="app-sidebar">
          <section className="sidebar-section connections">
            <div className="sidebar-header">
              <span>MySQL 连接</span>
              <div className="sidebar-header-actions">
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => void importConnections()} title="导入">
                  ↓
                </button>
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => void exportConnections()} title="导出">
                  ↑
                </button>
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => openConnModal()} title="新建">
                  <IconPlus size={14} />
                </button>
              </div>
            </div>
            <div className="sidebar-body connections-body">
              {connectionList.length === 0 ? (
                <div className="empty-hint">创建 MySQL 连接以开始</div>
              ) : (
                groupedConnections.map(([group, list]) => (
                  <div key={group} className="conn-group">
                    <div className="conn-group-title">{group}</div>
                    <ul className="conn-list">
                      {list.map((c) => (
                        <li
                          key={c.id}
                          className={`conn-item ${activeConnectionId === c.id ? 'active' : ''} ${session?.connectionId === c.id ? 'connected' : ''}`}
                          onClick={() => connect(c.id)}
                          onDoubleClick={() => connect(c.id)}
                        >
                          <span className="conn-dot" />
                          <div className="conn-meta">
                            <span className="conn-name">
                              {c.name}
                              {c.sshEnabled && <span className="conn-ssh-tag">SSH</span>}
                            </span>
                            <span className="conn-host">
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

          <section className="sidebar-section objects">
            <div className="sidebar-header">
              <span>对象浏览器</span>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-sm"
                onClick={() => void refreshObjectTree()}
                disabled={!session}
                title="刷新"
              >
                ↻
              </button>
            </div>
            {session && (
              <div className="sidebar-filter">
                <input
                  className="wn-input wn-input-sm"
                  placeholder="筛选表/视图…"
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
                  onTableDoubleClick={openTableTab}
                  onShowDDL={showDDL}
                  onShowIndexes={showIndexes}
                  onNewTable={openCreateTableTab}
                  onDesignTable={openDesignTableTab}
                  onTruncateTable={truncateTable}
                  onDropTable={dropTable}
                  onExportInsert={exportTableInsert}
                />
              ) : (
                <div className="empty-hint">连接后浏览库表结构</div>
              )}
            </div>
          </section>

          <section className="sidebar-section history">
            <div className="sidebar-header">
              <span>查询历史</span>
            </div>
            <div className="sidebar-body">
              {history.length === 0 ? (
                <div className="empty-hint" style={{ padding: '12px 8px' }}>
                  暂无记录
                </div>
              ) : (
                history.map((h) => (
                  <div
                    key={h.id}
                    className={`history-item ${h.success ? '' : 'failed'}`}
                    title={h.sql}
                    onClick={() => addTab({ id: `sql-h-${h.id}`, kind: 'sql', title: '历史查询', sql: h.sql })}
                  >
                    {h.sql.slice(0, 50)}
                    {h.sql.length > 50 ? '…' : ''}
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        <main className="app-main">
          <div className="editor-chrome">
            <div className="wn-tabs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`wn-tab wn-tab-${t.kind} ${t.id === activeTabId ? 'active' : ''}`}
                  onClick={() => setActiveTabId(t.id)}
                >
                  <span className="tab-dot" />
                  <span className="tab-title">{t.title}</span>
                  <span className="wn-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}>
                    ×
                  </span>
                </button>
              ))}
              <button type="button" className="wn-tab wn-tab-add" onClick={newSqlTab} title="新建查询">
                +
              </button>
            </div>
            {session && activeTab?.kind === 'sql' && (
              <div className="query-bar">
                <label>数据库</label>
                <select
                  className="wn-select"
                  value={session.database}
                  onChange={async (e) => setSession(await api.setDatabase(session.sessionId, e.target.value))}
                >
                  <option value="">选择…</option>
                  {treeNodes.map((db) => (
                    <option key={db.id} value={db.label}>
                      {db.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="workspace">
            {!activeTab && (
              <div className="pane-empty">
                <span>新建查询或双击表打开数据</span>
              </div>
            )}
            {activeTab?.kind === 'sql' && (
              <div className="sql-workspace">
                <SqlEditor
                  ref={sqlEditorRef}
                  tabId={activeTab.id}
                  sql={activeTab.sql}
                  onChange={(sql) => updateSqlTab(activeTab.id, sql)}
                  onExecute={runSql}
                />
                <div
                  className="resize-handle-h"
                  onMouseDown={(e) => {
                    const startY = e.clientY
                    const startH = resultHeight
                    const onMove = (ev: MouseEvent) => setResultHeight(Math.max(120, startH - (ev.clientY - startY)))
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                    }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                />
                <div className="bottom-panel" style={{ height: resultHeight }}>
                  <div className="bottom-panel-tabs">
                    <button
                      type="button"
                      className={`bottom-panel-tab ${bottomTab === 'result' ? 'active' : ''}`}
                      onClick={() => setBottomTab('result')}
                    >
                      结果
                    </button>
                    <button
                      type="button"
                      className={`bottom-panel-tab ${bottomTab === 'message' ? 'active' : ''}`}
                      onClick={() => setBottomTab('message')}
                    >
                      消息
                    </button>
                  </div>
                  <div className="bottom-panel-body">
                    {bottomTab === 'result' ? (
                      <ResultPanel
                        result={sqlResult}
                        message={statusMessage}
                        onExport={lastQuery ? exportResult : undefined}
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
              <TableDataEditor sessionId={session.sessionId} database={activeTab.database} table={activeTab.table} />
            )}
            {activeTab?.kind === 'table' && !session && (
              <div className="pane-empty">
                <span>请先连接数据库</span>
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
              <TableDesignEditor
                tabId={activeTab.id}
                sessionId={session.sessionId}
                database={activeTab.database}
                mode={activeTab.mode}
                table={activeTab.table}
                onSaved={async () => {
                  setObjectTree(await api.getObjectTree(session.sessionId))
                }}
                onCreated={
                  activeTab.mode === 'create'
                    ? (tableName) => handleTableCreated(activeTab.id, activeTab.database, tableName)
                    : undefined
                }
                onStatus={setStatusMessage}
                onOpenDDL={(sql, title) => openDdlTab(sql, title, activeTab.database)}
              />
            )}
            {activeTab?.kind === 'design' && !session && (
              <div className="pane-empty">
                <span>请先连接数据库</span>
              </div>
            )}
          </div>
        </main>
      </div>

      <ConnectionModal
        open={connModalOpen}
        initial={editingConn}
        onClose={() => setConnModalOpen(false)}
        onSaved={refreshConnections}
      />
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, ExecuteResult, QueryHistory, QueryPage } from '../../api/types'
import { IconDisconnect, IconEdit, IconPlay, IconPlus, IconSql } from '../../components/Icons'
import { ConnectionModal } from '../../features/connection/ConnectionModal'
import { ObjectTree } from '../../features/explorer/ObjectTree'
import { ResultPanel } from '../../features/sql-editor/ResultPanel'
import { SqlEditor } from '../../features/sql-editor/SqlEditor'
import { TableDataEditor } from '../../features/table-data/TableDataEditor'
import { useAppStore } from '../../stores/appStore'
import { queryPageToCSV } from '../../utils/queryCsv'

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
    addTab,
    updateSqlTab,
    statusMessage,
  } = useAppStore()

  const [connModalOpen, setConnModalOpen] = useState(false)
  const [editingConn, setEditingConn] = useState<Connection | null>(null)
  const [sqlResult, setSqlResult] = useState<QueryPage | ExecuteResult | null>(null)
  const [resultHeight, setResultHeight] = useState(220)
  const [bottomTab, setBottomTab] = useState<'result' | 'message'>('result')
  const [history, setHistory] = useState<QueryHistory[]>([])
  const [lastQuery, setLastQuery] = useState<{ sql: string; page: QueryPage } | null>(null)

  useEffect(() => {
    refreshConnections()
  }, [])

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

  const connectionList = connections ?? []
  const treeNodes = objectTree ?? []
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

  const runSql = useCallback(async () => {
    if (!session || !activeTab || activeTab.kind !== 'sql') return
    setBottomTab('result')
    setStatusMessage('正在执行...')
    try {
      const res = await api.executeSQL(session.sessionId, session.database, activeTab.sql)
      if (res && typeof res === 'object' && 'columns' in (res as QueryPage)) {
        const page = res as QueryPage
        setSqlResult(page)
        setLastQuery({ sql: activeTab.sql, page })
        setStatusMessage(`查询完成 · ${page.elapsedMs} ms`)
      } else {
        setSqlResult(res as ExecuteResult)
        setLastQuery(null)
        setStatusMessage('执行完成')
      }
      setHistory(await api.listQueryHistory(session.connectionId, 30))
    } catch (e) {
      setSqlResult(null)
      setStatusMessage((e as Error).message)
      setBottomTab('message')
    }
  }, [session, activeTab])

  const openTableTab = (database: string, table: string) => {
    const id = `table-${database}-${table}`
    if (!tabs.find((t) => t.id === id)) {
      addTab({ id, kind: 'table', title: table, database, table })
    } else {
      setActiveTabId(id)
    }
  }

  const showDDL = async (database: string, table: string) => {
    if (!session) return
    try {
      const ddl = await api.getTableDDL(session.sessionId, database, table)
      const id = `ddl-${database}-${table}`
      if (!tabs.find((t) => t.id === id)) {
        addTab({ id, kind: 'ddl', title: `DDL · ${table}`, content: ddl })
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

  const connLabel = session && activeConn ? `${activeConn.name} · ${activeConn.host}:${activeConn.port}` : '未连接'

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
          <button type="button" className="wn-btn wn-btn-chrome" onClick={disconnect} disabled={!session} title="断开">
            <IconDisconnect size={13} />
          </button>
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
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => openConnModal()} title="新建">
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body connections-body">
              {connectionList.length === 0 ? (
                <div className="empty-hint">创建 MySQL 连接以开始</div>
              ) : (
                <ul className="conn-list">
                  {connectionList.map((c) => (
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
              )}
            </div>
          </section>

          <section className="sidebar-section objects">
            <div className="sidebar-header">
              <span>对象浏览器</span>
            </div>
            <div className="sidebar-body">
              {session ? (
                <ObjectTree nodes={treeNodes} onTableDoubleClick={openTableTab} onShowDDL={showDDL} />
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
                      <ResultPanel result={sqlResult} message={statusMessage} onExport={lastQuery ? exportResult : undefined} />
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
            {activeTab?.kind === 'ddl' && <pre className="ddl-view">{activeTab.content}</pre>}
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

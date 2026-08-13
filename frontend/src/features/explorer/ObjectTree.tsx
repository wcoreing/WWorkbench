import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnMeta, ObjectTreeNode } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { isMysqlSystemDatabase } from './mysqlSystemDb'
import '../../components/ui.css'

interface ContextMenuState {
  x: number
  y: number
  node: ObjectTreeNode
}

interface Props {
  sessionId: string
  nodes: ObjectTreeNode[]
  filter: string
  /** selectedDatabase 当前会话库；变化时自动展开该库表树。 */
  selectedDatabase?: string
  /** selectedTable 当前打开的表（用于与 Tab 同步高亮）。 */
  selectedTable?: string
  /** refreshNonce 递增时清空懒加载缓存并重载已展开节点。 */
  refreshNonce?: number
  onTableDoubleClick: (database: string, table: string) => void
  onDatabaseSelect?: (database: string) => void
  onShowDDL: (database: string, table: string) => void
  onShowIndexes: (database: string, table: string) => void
  onNewTable: (database: string) => void
  onDesignTable: (database: string, table: string) => void
  onTruncateTable: (database: string, table: string) => void
  onDropTable: (database: string, table: string) => void
  onExportInsert: (database: string, table: string) => void
  onImportSQL?: (database: string) => void
  onCreateDatabase?: () => void
  /** canCreateTable 库节点右键「新建表」。 */
  canCreateTable?: boolean
  /** canDesignTable 表节点右键「设计表」。 */
  canDesignTable?: boolean
  isRedis?: boolean
}

/** ObjectTree 数据库对象树（库/表/列均懒加载）。 */
export function ObjectTree({
  sessionId,
  nodes,
  filter,
  selectedDatabase,
  selectedTable,
  refreshNonce = 0,
  onTableDoubleClick,
  onDatabaseSelect,
  onShowDDL,
  onShowIndexes,
  onNewTable,
  onDesignTable,
  onTruncateTable,
  onDropTable,
  onExportInsert,
  onImportSQL,
  onCreateDatabase,
  canCreateTable = false,
  canDesignTable = false,
  isRedis = false,
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [databaseCache, setDatabaseCache] = useState<Record<string, ObjectTreeNode[]>>({})
  const [columnCache, setColumnCache] = useState<Record<string, ObjectTreeNode[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const expandedRef = useRef(expanded)
  const nodesRef = useRef(nodes)
  const databaseCacheRef = useRef(databaseCache)
  const columnCacheRef = useRef(columnCache)
  expandedRef.current = expanded
  nodesRef.current = nodes
  databaseCacheRef.current = databaseCache
  columnCacheRef.current = columnCache

  useEffect(() => {
    setExpanded(new Set())
    setDatabaseCache({})
    setColumnCache({})
    setSelectedId(null)
  }, [sessionId])

  // 顶部刷新：清空懒加载缓存，并重拉已展开库 + 当前选中库的表/列。
  useEffect(() => {
    if (!refreshNonce) return
    let cancelled = false
    const expandedIds = new Set(expandedRef.current)
    const treeNodes = nodesRef.current

    const run = async () => {
      setDatabaseCache({})
      setColumnCache({})
      const dbNodes = treeNodes.filter((n) => {
        if (n.nodeType !== 'database' || !n.database) return false
        return expandedIds.has(n.id) || n.database === selectedDatabase
      })
      const nextDbCache: Record<string, ObjectTreeNode[]> = {}
      await Promise.all(
        dbNodes.map(async (node) => {
          try {
            nextDbCache[node.id] = await api.listDatabaseObjects(sessionId, node.database!)
          } catch {
            nextDbCache[node.id] = []
          }
        }),
      )
      if (cancelled) return
      setDatabaseCache(nextDbCache)

      const nextColCache: Record<string, ObjectTreeNode[]> = {}
      const tableNodes = Object.values(nextDbCache)
        .flat()
        .filter(
          (n) =>
            (n.nodeType === 'table' || n.nodeType === 'view') &&
            expandedIds.has(n.id) &&
            n.database &&
            n.table,
        )
      await Promise.all(
        tableNodes.map(async (node) => {
          try {
            const cols = await api.listColumns(sessionId, node.database!, node.table!)
            nextColCache[node.id] = columnNodesFromMeta(node, cols)
          } catch {
            nextColCache[node.id] = []
          }
        }),
      )
      if (cancelled) return
      setColumnCache(nextColCache)
      // 选中库未展开时，刷新后也展开，避免只看到库名、看不到新表。
      if (selectedDatabase) {
        const dbNode = treeNodes.find(
          (n) => n.nodeType === 'database' && n.database === selectedDatabase,
        )
        if (dbNode) {
          setExpanded((prev) => {
            if (prev.has(dbNode.id)) return prev
            const next = new Set(prev)
            next.add(dbNode.id)
            return next
          })
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refreshNonce, sessionId, selectedDatabase])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const filteredNodes = useMemo(
    () => filterTree(nodes, filter.trim().toLowerCase(), databaseCache),
    [nodes, filter, databaseCache]
  )

  /** treeHint 节点悬停提示。 */
  const treeHint = useCallback(
    (node: ObjectTreeNode) => {
      if (node.nodeType === 'database') return t('objectTree.databaseHint')
      if (node.nodeType === 'table') return t('objectTree.tableHint')
      if (node.nodeType === 'view') return t('objectTree.viewHint')
      return node.label
    },
    [t]
  )

  /** loadDatabaseObjects 懒加载库内表/视图。 */
  const loadDatabaseObjects = useCallback(
    async (node: ObjectTreeNode) => {
      if (!node.database || databaseCacheRef.current[node.id]) return
      setLoadingId(node.id)
      try {
        const children = await api.listDatabaseObjects(sessionId, node.database)
        setDatabaseCache((prev) => ({ ...prev, [node.id]: children }))
      } catch {
        setDatabaseCache((prev) => ({ ...prev, [node.id]: [] }))
      } finally {
        setLoadingId(null)
      }
    },
    [sessionId],
  )

  /** loadColumns 懒加载表/视图列节点。 */
  const loadColumns = useCallback(
    async (node: ObjectTreeNode) => {
      if (!node.database || !node.table || columnCacheRef.current[node.id]) return
      setLoadingId(node.id)
      try {
        const cols = await api.listColumns(sessionId, node.database, node.table)
        setColumnCache((prev) => ({ ...prev, [node.id]: columnNodesFromMeta(node, cols) }))
      } catch {
        setColumnCache((prev) => ({ ...prev, [node.id]: [] }))
      } finally {
        setLoadingId(null)
      }
    },
    [sessionId],
  )

  /** ensureExpanded 展开节点并按需懒加载子节点。 */
  const ensureExpanded = useCallback(
    async (node: ObjectTreeNode) => {
      const isDatabase = node.nodeType === 'database'
      const isTableOrView = node.nodeType === 'table' || node.nodeType === 'view'
      if (!isDatabase && !isTableOrView) return
      if (isDatabase && !databaseCacheRef.current[node.id]) {
        await loadDatabaseObjects(node)
      } else if (isTableOrView && !columnCacheRef.current[node.id]) {
        await loadColumns(node)
      }
      setExpanded((prev) => {
        if (prev.has(node.id)) return prev
        const next = new Set(prev)
        next.add(node.id)
        return next
      })
    },
    [loadDatabaseObjects, loadColumns],
  )

  // 选中库后默认展开表树（含顶部下拉 / 库列表进入后）。
  useEffect(() => {
    if (!selectedDatabase) return
    const dbNode = nodes.find((n) => n.nodeType === 'database' && n.database === selectedDatabase)
    if (!dbNode) return
    setSelectedId((prev) => prev ?? dbNode.id)
    void ensureExpanded(dbNode)
  }, [selectedDatabase, nodes, ensureExpanded])

  // 与打开的表 Tab 同步高亮。
  useEffect(() => {
    if (!selectedDatabase || !selectedTable) return
    const dbNode = nodes.find((n) => n.nodeType === 'database' && n.database === selectedDatabase)
    if (!dbNode) return
    const children = databaseCache[dbNode.id] ?? []
    const tableNode = children.find(
      (n) => (n.nodeType === 'table' || n.nodeType === 'view') && n.table === selectedTable,
    )
    if (tableNode) setSelectedId(tableNode.id)
  }, [selectedDatabase, selectedTable, nodes, databaseCache])

  /** toggleExpand 展开/折叠节点。 */
  const toggleExpand = async (node: ObjectTreeNode, e: React.MouseEvent) => {
    e.stopPropagation()
    const isDatabase = node.nodeType === 'database'
    const isTableOrView = node.nodeType === 'table' || node.nodeType === 'view'
    if (!isDatabase && !isTableOrView) return

    if (expanded.has(node.id)) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(node.id)
        return next
      })
      return
    }
    await ensureExpanded(node)
  }

  /** handleNodeClick 单击：库则选中并展开，表/视图则打开并高亮。 */
  const handleNodeClick = (node: ObjectTreeNode) => {
    if (node.nodeType === 'database' && node.database) {
      setSelectedId(node.id)
      onDatabaseSelect?.(node.database)
      void ensureExpanded(node)
      return
    }
    if ((node.nodeType === 'table' || node.nodeType === 'view') && node.database && node.table) {
      setSelectedId(node.id)
      onTableDoubleClick(node.database, node.table)
    }
  }

  /** openContextMenu 打开右键菜单。 */
  const openContextMenu = (e: React.MouseEvent, node: ObjectTreeNode) => {
    if (node.nodeType === 'database') {
      if (!node.database) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, node })
      return
    }
    if (node.nodeType !== 'table' && node.nodeType !== 'view') return
    if (!node.database || !node.table) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  /** copyTableName 复制表名到剪贴板。 */
  const copyTableName = (node: ObjectTreeNode) => {
    if (!node.database || !node.table) return
    const text = `\`${node.database}\`.\`${node.table}\``
    void navigator.clipboard.writeText(text)
    setMenu(null)
  }

  const renderNode = (node: ObjectTreeNode, depth = 0) => {
    const isDatabase = node.nodeType === 'database'
    const isTableOrView = node.nodeType === 'table' || node.nodeType === 'view'
    const expandable = isDatabase || isTableOrView
    const isOpen = expanded.has(node.id)
    const children = isTableOrView
      ? (columnCache[node.id] ?? [])
      : isDatabase
        ? (databaseCache[node.id] ?? [])
        : (node.children ?? [])
    const showChildren = expandable && isOpen

    return (
      <li key={node.id}>
        <div
          className={`wn-tree-item ${node.nodeType}${isDatabase && node.database ? ' selectable' : ''}${
            selectedId === node.id ? ' selected' : ''
          }`}
          style={{ paddingLeft: 6 + depth * 16 }}
          onClick={() => handleNodeClick(node)}
          onContextMenu={(e) => openContextMenu(e, node)}
          title={treeHint(node)}
        >
          {expandable ? (
            <button
              type="button"
              className="tree-expand"
              onClick={(e) => void toggleExpand(node, e)}
              aria-label={isOpen ? t('objectTree.collapse') : t('objectTree.expand')}
            >
              {loadingId === node.id ? '…' : isOpen ? '▼' : '▶'}
            </button>
          ) : (
            <span className="tree-expand tree-expand-placeholder" />
          )}
          <span className="tree-icon">{treeIcon(node.nodeType, node.label)}</span>
          <span className="tree-label">{node.label}</span>
          {isDatabase && isMysqlSystemDatabase(node.label) && (
            <span className="tree-tag">{t('database.systemDatabase')}</span>
          )}
        </div>
        {showChildren && (
          <ul className="wn-tree">
            {children.length > 0 ? (
              children.map((c) => renderNode(c, depth + 1))
            ) : (
              <li className="tree-empty-item">{t('objectTree.emptyDatabase')}</li>
            )}
          </ul>
        )}
      </li>
    )
  }

  if (!nodes.length) {
    return <div className="empty-hint">{t('objectTree.connectFirst')}</div>
  }

  if (!filteredNodes.length) {
    return <div className="empty-hint">{t('objectTree.noMatch')}</div>
  }

  return (
    <>
      <ul className="wn-tree">{filteredNodes.map((n) => renderNode(n))}</ul>
      {menu && (
        <div className="wn-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {canCreateTable && menu.node.nodeType === 'database' && menu.node.database && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                onNewTable(menu.node.database!)
                setMenu(null)
              }}
            >
              {t('objectTree.designNewTable')}
            </button>
          )}
          {onImportSQL && menu.node.nodeType === 'database' && menu.node.database && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                onImportSQL(menu.node.database!)
                setMenu(null)
              }}
            >
              {t('objectTree.importSql')}
            </button>
          )}
          {(menu.node.nodeType === 'table' || menu.node.nodeType === 'view') && (
            <>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              if (menu.node.database && menu.node.table) onTableDoubleClick(menu.node.database, menu.node.table)
              setMenu(null)
            }}
          >
            {isRedis ? t('objectTree.openKey') : t('objectTree.openTable')}
          </button>
          {!isRedis && (
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              if (menu.node.database && menu.node.table) onShowDDL(menu.node.database, menu.node.table)
              setMenu(null)
            }}
          >
            {t('objectTree.viewDdl')}
          </button>
          )}
          {canDesignTable && menu.node.nodeType === 'table' && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                if (menu.node.database && menu.node.table) onDesignTable(menu.node.database, menu.node.table)
                setMenu(null)
              }}
            >
              {t('objectTree.designTable')}
            </button>
          )}
          {!isRedis && menu.node.nodeType === 'table' && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                if (menu.node.database && menu.node.table) onShowIndexes(menu.node.database, menu.node.table)
                setMenu(null)
              }}
            >
              {t('objectTree.viewIndexes')}
            </button>
          )}
          {!isRedis && menu.node.nodeType === 'table' && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                if (menu.node.database && menu.node.table) onExportInsert(menu.node.database, menu.node.table)
                setMenu(null)
              }}
            >
              {t('objectTree.exportInsert')}
            </button>
          )}
          {!isRedis && menu.node.nodeType === 'table' && (
            <>
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                onClick={() => {
                  if (menu.node.database && menu.node.table) onTruncateTable(menu.node.database, menu.node.table)
                  setMenu(null)
                }}
              >
                {t('objectTree.truncateTable')}
              </button>
              <button
                type="button"
                className="wn-context-item danger"
                onClick={() => {
                  if (menu.node.database && menu.node.table) onDropTable(menu.node.database, menu.node.table)
                  setMenu(null)
                }}
              >
                {t('objectTree.dropTable')}
              </button>
            </>
          )}
          <div className="wn-context-sep" />
          <button type="button" className="wn-context-item" onClick={() => copyTableName(menu.node)}>
            {t('objectTree.copyTableName')}
          </button>
            </>
          )}
        </div>
      )}
    </>
  )
}

/** columnNodesFromMeta 将列元数据转为树节点。 */
function columnNodesFromMeta(parent: ObjectTreeNode, cols: ColumnMeta[]): ObjectTreeNode[] {
  return cols.map((c) => ({
    id: `${parent.id}:col:${c.name}`,
    label: `${c.name} : ${c.columnType || c.dataType}`,
    nodeType: 'column' as const,
    database: parent.database,
    table: parent.table,
  }))
}

/** filterTree 按名称筛选库表视图（仅匹配已加载的表）。 */
function filterTree(
  nodes: ObjectTreeNode[],
  keyword: string,
  databaseCache: Record<string, ObjectTreeNode[]>
): ObjectTreeNode[] {
  if (!keyword) return nodes
  return nodes
    .map((db) => {
      const cached = databaseCache[db.id] ?? []
      const children = cached.filter((c) => c.label.toLowerCase().includes(keyword))
      if (db.label.toLowerCase().includes(keyword) || children.length > 0) {
        return { ...db, children: children.length ? children : undefined }
      }
      return null
    })
    .filter(Boolean) as ObjectTreeNode[]
}

function treeIcon(type: string, label?: string) {
  if (type === 'database') return label && isMysqlSystemDatabase(label) ? '⚙' : '◆'
  if (type === 'table') return '▤'
  if (type === 'view') return '◇'
  if (type === 'column') return '│'
  return '○'
}

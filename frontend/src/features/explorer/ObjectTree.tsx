import { useCallback, useEffect, useMemo, useState } from 'react'
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
  tableDesign?: boolean
  isRedis?: boolean
}

/** ObjectTree 数据库对象树（库/表/列均懒加载）。 */
export function ObjectTree({
  sessionId,
  nodes,
  filter,
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
  tableDesign = true,
  isRedis = false,
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [databaseCache, setDatabaseCache] = useState<Record<string, ObjectTreeNode[]>>({})
  const [columnCache, setColumnCache] = useState<Record<string, ObjectTreeNode[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    setExpanded(new Set())
    setDatabaseCache({})
    setColumnCache({})
  }, [sessionId, nodes])

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
      if (!node.database || databaseCache[node.id]) return
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
    [sessionId, databaseCache]
  )

  /** loadColumns 懒加载表/视图列节点。 */
  const loadColumns = useCallback(
    async (node: ObjectTreeNode) => {
      if (!node.database || !node.table || columnCache[node.id]) return
      setLoadingId(node.id)
      try {
        const cols: ColumnMeta[] = await api.listColumns(sessionId, node.database, node.table)
        const children: ObjectTreeNode[] = cols.map((c) => ({
          id: `${node.id}:col:${c.name}`,
          label: `${c.name} : ${c.columnType || c.dataType}`,
          nodeType: 'column',
          database: node.database,
          table: node.table,
        }))
        setColumnCache((prev) => ({ ...prev, [node.id]: children }))
      } catch {
        setColumnCache((prev) => ({ ...prev, [node.id]: [] }))
      } finally {
        setLoadingId(null)
      }
    },
    [sessionId, columnCache]
  )

  /** toggleExpand 展开/折叠节点。 */
  const toggleExpand = async (node: ObjectTreeNode, e: React.MouseEvent) => {
    e.stopPropagation()
    const isDatabase = node.nodeType === 'database'
    const isTableOrView = node.nodeType === 'table' || node.nodeType === 'view'
    if (!isDatabase && !isTableOrView) return

    const next = new Set(expanded)
    if (next.has(node.id)) {
      next.delete(node.id)
      setExpanded(next)
      return
    }
    if (isDatabase && !databaseCache[node.id]) {
      await loadDatabaseObjects(node)
    } else if (isTableOrView && !columnCache[node.id]) {
      await loadColumns(node)
    }
    next.add(node.id)
    setExpanded(next)
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
          className={`wn-tree-item ${node.nodeType}${isDatabase && node.database ? ' selectable' : ''}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          onClick={() => {
            if (isDatabase && node.database && onDatabaseSelect) {
              onDatabaseSelect(node.database)
            }
          }}
          onDoubleClick={() => {
            if (isTableOrView && node.database && node.table) {
              onTableDoubleClick(node.database, node.table)
            }
          }}
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
          {tableDesign && menu.node.nodeType === 'database' && menu.node.database && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                onNewTable(menu.node.database!)
                setMenu(null)
              }}
            >
              {t('objectTree.newTable')}
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
          {tableDesign && menu.node.nodeType === 'table' && (
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

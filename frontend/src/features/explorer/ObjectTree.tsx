import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnMeta, ObjectTreeNode } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
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
  onShowDDL: (database: string, table: string) => void
  onShowIndexes: (database: string, table: string) => void
  onNewTable: (database: string) => void
  onDesignTable: (database: string, table: string) => void
  onTruncateTable: (database: string, table: string) => void
  onDropTable: (database: string, table: string) => void
  onExportInsert: (database: string, table: string) => void
}

/** ObjectTree 数据库对象树（支持懒加载列、右键菜单、筛选）。 */
export function ObjectTree({
  sessionId,
  nodes,
  filter,
  onTableDoubleClick,
  onShowDDL,
  onShowIndexes,
  onNewTable,
  onDesignTable,
  onTruncateTable,
  onDropTable,
  onExportInsert,
}: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [columnCache, setColumnCache] = useState<Record<string, ObjectTreeNode[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const filteredNodes = useMemo(() => filterTree(nodes, filter.trim().toLowerCase()), [nodes, filter])

  /** treeHint 节点悬停提示。 */
  const treeHint = useCallback(
    (node: ObjectTreeNode) => {
      if (node.nodeType === 'table') return t('objectTree.tableHint')
      if (node.nodeType === 'view') return t('objectTree.viewHint')
      return node.label
    },
    [t]
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
    if (node.nodeType !== 'table' && node.nodeType !== 'view') return
    const next = new Set(expanded)
    if (next.has(node.id)) {
      next.delete(node.id)
      setExpanded(next)
      return
    }
    if (!columnCache[node.id]) {
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
    const expandable = node.nodeType === 'table' || node.nodeType === 'view'
    const isOpen = expanded.has(node.id)
    const children = expandable ? columnCache[node.id] ?? [] : node.children ?? []
    const showChildren = expandable ? isOpen : (node.children?.length ?? 0) > 0

    return (
      <li key={node.id}>
        <div
          className={`wn-tree-item ${node.nodeType}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          onDoubleClick={() => {
            if ((node.nodeType === 'table' || node.nodeType === 'view') && node.database && node.table) {
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
          <span className="tree-icon">{treeIcon(node.nodeType)}</span>
          <span className="tree-label">{node.label}</span>
        </div>
        {showChildren && children.length > 0 && (
          <ul className="wn-tree">{children.map((c) => renderNode(c, depth + 1))}</ul>
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
          {menu.node.nodeType === 'database' && menu.node.database && (
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
            {t('objectTree.openTable')}
          </button>
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
          {menu.node.nodeType === 'table' && (
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
          {menu.node.nodeType === 'table' && (
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
          {menu.node.nodeType === 'table' && (
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
          {menu.node.nodeType === 'table' && (
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

/** filterTree 按名称筛选库表视图。 */
function filterTree(nodes: ObjectTreeNode[], keyword: string): ObjectTreeNode[] {
  if (!keyword) return nodes
  return nodes
    .map((db) => {
      const children = (db.children ?? []).filter((c) => c.label.toLowerCase().includes(keyword))
      if (db.label.toLowerCase().includes(keyword) || children.length > 0) {
        return { ...db, children: children.length ? children : db.children }
      }
      return null
    })
    .filter(Boolean) as ObjectTreeNode[]
}

function treeIcon(type: string) {
  if (type === 'database') return '◆'
  if (type === 'table') return '▤'
  if (type === 'view') return '◇'
  if (type === 'column') return '│'
  return '○'
}


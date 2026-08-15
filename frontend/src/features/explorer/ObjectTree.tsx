import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnMeta, IndexMeta, ObjectTreeNode } from '../../api/types'
import { api } from '../../api/client'
import { ContextMenu } from '../../components/ContextMenu'
import { Icon, type IconName } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { isMysqlSystemDatabase } from './mysqlSystemDb'
import '../../components/ui.css'
import { pressProps, useDismissOverlays } from '../../components/compat'

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
  onExportTableSQL: (database: string, table: string) => void
  onExportDatabaseSQL?: (database: string) => void
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
  onExportTableSQL,
  onExportDatabaseSQL,
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
  const [indexCache, setIndexCache] = useState<Record<string, ObjectTreeNode[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useDismissOverlays(() => setMenu(null))
  const expandedRef = useRef(expanded)
  const nodesRef = useRef(nodes)
  const databaseCacheRef = useRef(databaseCache)
  const columnCacheRef = useRef(columnCache)
  const indexCacheRef = useRef(indexCache)
  expandedRef.current = expanded
  nodesRef.current = nodes
  databaseCacheRef.current = databaseCache
  columnCacheRef.current = columnCache
  indexCacheRef.current = indexCache

  useEffect(() => {
    setExpanded(new Set())
    setDatabaseCache({})
    setColumnCache({})
    setIndexCache({})
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
      setIndexCache({})
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
      const nextIdxCache: Record<string, ObjectTreeNode[]> = {}
      const tableNodes = Object.values(nextDbCache)
        .flat()
        .filter(
          (n) =>
            (n.nodeType === 'table' || n.nodeType === 'view') &&
            n.database &&
            n.table,
        )
      await Promise.all(
        tableNodes.map(async (node) => {
          const colId = isRedis ? node.id : `${node.id}:columns`
          const idxId = `${node.id}:indexes`
          const needCols = expandedIds.has(colId) || (isRedis && expandedIds.has(node.id))
          const needIdx = !isRedis && expandedIds.has(idxId)
          if (needCols) {
            try {
              const cols = await api.listColumns(sessionId, node.database!, node.table!)
              nextColCache[colId] = columnNodesFromMeta(node, cols)
            } catch {
              nextColCache[colId] = []
            }
          }
          if (needIdx) {
            try {
              const idxs = await api.listIndexes(sessionId, node.database!, node.table!)
              nextIdxCache[idxId] = indexNodesFromMeta(node, idxs)
            } catch {
              nextIdxCache[idxId] = []
            }
          }
        }),
      )
      if (cancelled) return
      setColumnCache(nextColCache)
      setIndexCache(nextIdxCache)
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
  }, [refreshNonce, sessionId, selectedDatabase, isRedis])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
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

  /** loadColumns 懒加载列节点（Redis 表直挂 / 普通表挂在「列」分组下）。 */
  const loadColumns = useCallback(
    async (node: ObjectTreeNode, cacheKey: string) => {
      if (!node.database || !node.table || columnCacheRef.current[cacheKey]) return
      setLoadingId(cacheKey)
      try {
        const cols = await api.listColumns(sessionId, node.database, node.table)
        setColumnCache((prev) => ({ ...prev, [cacheKey]: columnNodesFromMeta(node, cols) }))
      } catch {
        setColumnCache((prev) => ({ ...prev, [cacheKey]: [] }))
      } finally {
        setLoadingId(null)
      }
    },
    [sessionId],
  )

  /** loadIndexes 懒加载索引节点。 */
  const loadIndexes = useCallback(
    async (node: ObjectTreeNode, cacheKey: string) => {
      if (!node.database || !node.table || indexCacheRef.current[cacheKey]) return
      setLoadingId(cacheKey)
      try {
        const idxs = await api.listIndexes(sessionId, node.database, node.table)
        setIndexCache((prev) => ({ ...prev, [cacheKey]: indexNodesFromMeta(node, idxs) }))
      } catch {
        setIndexCache((prev) => ({ ...prev, [cacheKey]: [] }))
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
      const isGroup = isTableGroupType(node.nodeType)
      if (!isDatabase && !isTableOrView && !isGroup) return

      if (isDatabase && !databaseCacheRef.current[node.id]) {
        await loadDatabaseObjects(node)
      } else if (isTableOrView && isRedis && !columnCacheRef.current[node.id]) {
        await loadColumns(node, node.id)
      } else if (node.nodeType === 'columns') {
        await loadColumns(node, node.id)
      } else if (node.nodeType === 'indexes') {
        await loadIndexes(node, node.id)
      }

      setExpanded((prev) => {
        if (prev.has(node.id)) return prev
        const next = new Set(prev)
        next.add(node.id)
        return next
      })
    },
    [loadDatabaseObjects, loadColumns, loadIndexes, isRedis],
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
  const toggleExpand = async (node: ObjectTreeNode) => {
    const isDatabase = node.nodeType === 'database'
    const isTableOrView = node.nodeType === 'table' || node.nodeType === 'view'
    const isGroup = isTableGroupType(node.nodeType)
    if (!isDatabase && !isTableOrView && !isGroup) return

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

  /** handleNodeClick 单击：库则选中并展开，表/视图则打开并高亮；分组则展开。 */
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
      return
    }
    if (isTableGroupType(node.nodeType)) {
      setSelectedId(node.id)
      void ensureExpanded(node)
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
    const isGroup = isTableGroupType(node.nodeType)
    const expandable = isDatabase || isTableOrView || isGroup
    const isOpen = expanded.has(node.id)
    const children = resolveChildren(node, {
      isRedis,
      databaseCache,
      columnCache,
      indexCache,
      groupLabels: {
        columns: t('objectTree.groupColumns'),
        indexes: t('objectTree.groupIndexes'),
        foreignkeys: t('objectTree.groupForeignKeys'),
        triggers: t('objectTree.groupTriggers'),
        checkconstraints: t('objectTree.groupCheckConstraints'),
      },
    })
    const showChildren = expandable && isOpen
    const emptyHint =
      isGroup && !isRedis ? t('objectTree.emptyGroup') : t('objectTree.emptyDatabase')

    return (
      <li key={node.id}>
        <div
          className={`wn-tree-item ${node.nodeType}${isDatabase && node.database ? ' selectable' : ''}${
            selectedId === node.id ? ' selected' : ''
          }`}
          style={{ paddingLeft: 6 + depth * 16 }}
          {...pressProps(() => handleNodeClick(node))}
          onContextMenu={(e) => openContextMenu(e, node)}
          title={treeHint(node)}
        >
          {expandable ? (
            <button
              type="button"
              className="tree-expand"
              {...pressProps(() => void toggleExpand(node), { stop: true })}
              aria-label={isOpen ? t('objectTree.collapse') : t('objectTree.expand')}
            >
              {loadingId === node.id ? (
                <span className="tree-expand-loading">…</span>
              ) : (
                <span className={`tree-chevron${isOpen ? ' is-open' : ''}`} aria-hidden />
              )}
            </button>
          ) : (
            <span className="tree-expand tree-expand-placeholder" />
          )}
          <span className="tree-icon">{treeIcon(node.nodeType)}</span>
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
              <li className="tree-empty-item">{emptyHint}</li>
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
        <ContextMenu
          key={`obj-${menu.node.id}-${menu.x}-${menu.y}`}
          x={menu.x}
          y={menu.y}
          onClick={(e) => e.stopPropagation()}
        >
          {canCreateTable && menu.node.nodeType === 'database' && menu.node.database && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                onNewTable(menu.node.database!)
                setMenu(null)
              })}
            >
              {t('objectTree.designNewTable')}
            </button>
          )}
          {onImportSQL && menu.node.nodeType === 'database' && menu.node.database && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                onImportSQL(menu.node.database!)
                setMenu(null)
              })}
            >
              {t('objectTree.importSql')}
            </button>
          )}
          {onExportDatabaseSQL && menu.node.nodeType === 'database' && menu.node.database && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                onExportDatabaseSQL(menu.node.database!)
                setMenu(null)
              })}
            >
              {t('objectTree.exportDatabaseSql')}
            </button>
          )}
          {(menu.node.nodeType === 'table' || menu.node.nodeType === 'view') && (
            <>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              if (menu.node.database && menu.node.table) onTableDoubleClick(menu.node.database, menu.node.table)
              setMenu(null)
            })}
          >
            {isRedis ? t('objectTree.openKey') : t('objectTree.openTable')}
          </button>
          {!isRedis && (
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              if (menu.node.database && menu.node.table) onShowDDL(menu.node.database, menu.node.table)
              setMenu(null)
            })}
          >
            {t('objectTree.viewDdl')}
          </button>
          )}
          {canDesignTable && menu.node.nodeType === 'table' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                if (menu.node.database && menu.node.table) onDesignTable(menu.node.database, menu.node.table)
                setMenu(null)
              })}
            >
              {t('objectTree.designTable')}
            </button>
          )}
          {!isRedis && menu.node.nodeType === 'table' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                if (menu.node.database && menu.node.table) onShowIndexes(menu.node.database, menu.node.table)
                setMenu(null)
              })}
            >
              {t('objectTree.viewIndexes')}
            </button>
          )}
          {!isRedis && menu.node.nodeType === 'table' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                if (menu.node.database && menu.node.table) onExportTableSQL(menu.node.database, menu.node.table)
                setMenu(null)
              })}
            >
              {t('objectTree.exportTableSql')}
            </button>
          )}
          {!isRedis && menu.node.nodeType === 'table' && (
            <>
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  if (menu.node.database && menu.node.table) onTruncateTable(menu.node.database, menu.node.table)
                  setMenu(null)
                })}
              >
                {t('objectTree.truncateTable')}
              </button>
              <button
                type="button"
                className="wn-context-item danger"
                {...pressProps(() => {
                  if (menu.node.database && menu.node.table) onDropTable(menu.node.database, menu.node.table)
                  setMenu(null)
                })}
              >
                {t('objectTree.dropTable')}
              </button>
            </>
          )}
          <div className="wn-context-sep" />
          <button type="button" className="wn-context-item" {...pressProps(() => copyTableName(menu.node))}>
            {t('objectTree.copyTableName')}
          </button>
            </>
          )}
        </ContextMenu>
      )}
    </>
  )
}

/** columnNodesFromMeta 将列元数据转为树节点；主键用独立 nodeType。 */
function columnNodesFromMeta(parent: ObjectTreeNode, cols: ColumnMeta[]): ObjectTreeNode[] {
  return cols.map((c) => ({
    id: `${parent.id}:col:${c.name}`,
    label: `${c.name} : ${c.columnType || c.dataType}`,
    nodeType: c.isPrimaryKey ? 'primarykey' : 'column',
    database: parent.database,
    table: parent.table,
  }))
}

/** indexNodesFromMeta 按索引名去重后转为树节点。 */
function indexNodesFromMeta(parent: ObjectTreeNode, idxs: IndexMeta[]): ObjectTreeNode[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const i of idxs) {
    if (!i.name || seen.has(i.name)) continue
    seen.add(i.name)
    names.push(i.name)
  }
  return names.map((name) => ({
    id: `${parent.id}:idx:${name}`,
    label: name,
    nodeType: 'index' as const,
    database: parent.database,
    table: parent.table,
  }))
}

const TABLE_GROUP_TYPES = new Set([
  'columns',
  'indexes',
  'foreignkeys',
  'triggers',
  'checkconstraints',
])

/** isTableGroupType 是否为表下分组节点。 */
function isTableGroupType(type: string): boolean {
  return TABLE_GROUP_TYPES.has(type)
}

type GroupLabels = {
  columns: string
  indexes: string
  foreignkeys: string
  triggers: string
  checkconstraints: string
}

/** tableGroupNodes 表下固定分组：列 / 索引 / 外键 / 触发器 / 检查约束。 */
function tableGroupNodes(parent: ObjectTreeNode, labels: GroupLabels): ObjectTreeNode[] {
  return [
    {
      id: `${parent.id}:columns`,
      label: labels.columns,
      nodeType: 'columns',
      database: parent.database,
      table: parent.table,
      lazy: true,
    },
    {
      id: `${parent.id}:indexes`,
      label: labels.indexes,
      nodeType: 'indexes',
      database: parent.database,
      table: parent.table,
      lazy: true,
    },
    {
      id: `${parent.id}:foreignkeys`,
      label: labels.foreignkeys,
      nodeType: 'foreignkeys',
      database: parent.database,
      table: parent.table,
    },
    {
      id: `${parent.id}:triggers`,
      label: labels.triggers,
      nodeType: 'triggers',
      database: parent.database,
      table: parent.table,
    },
    {
      id: `${parent.id}:checkconstraints`,
      label: labels.checkconstraints,
      nodeType: 'checkconstraints',
      database: parent.database,
      table: parent.table,
    },
  ]
}

/** resolveChildren 计算节点子树。 */
function resolveChildren(
  node: ObjectTreeNode,
  opts: {
    isRedis: boolean
    databaseCache: Record<string, ObjectTreeNode[]>
    columnCache: Record<string, ObjectTreeNode[]>
    indexCache: Record<string, ObjectTreeNode[]>
    groupLabels: GroupLabels
  },
): ObjectTreeNode[] {
  if (node.nodeType === 'database') return opts.databaseCache[node.id] ?? []
  if (node.nodeType === 'table' || node.nodeType === 'view') {
    if (opts.isRedis) return opts.columnCache[node.id] ?? []
    return tableGroupNodes(node, opts.groupLabels)
  }
  if (node.nodeType === 'columns') return opts.columnCache[node.id] ?? []
  if (node.nodeType === 'indexes') return opts.indexCache[node.id] ?? []
  if (isTableGroupType(node.nodeType)) return []
  return node.children ?? []
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

function treeIconName(type: string): IconName {
  // 系统库与普通库共用 database 图标，靠「系统库」标签区分
  if (type === 'database') return 'database'
  if (type === 'table') return 'table'
  if (type === 'view') return 'view'
  if (type === 'column' || type === 'columns') return 'column'
  if (type === 'primarykey') return 'primarykey'
  if (type === 'index' || type === 'indexes') return 'index'
  if (type === 'foreignkeys' || type === 'foreignkey') return 'foreignkey'
  if (type === 'triggers' || type === 'trigger') return 'trigger'
  if (type === 'checkconstraints' || type === 'checkconstraint') return 'checkconstraint'
  if (type === 'schema') return 'schema'
  return 'schema'
}

function treeIcon(type: string) {
  return <Icon name={treeIconName(type)} size={14} />
}

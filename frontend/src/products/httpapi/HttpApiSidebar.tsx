import { Fragment, useCallback, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { HTTPFolder, HTTPSavedRequest } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPlus } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import {
  collectHttpTreeAll,
  collectHttpTreeSubtree,
  countBatchSelection,
  filterHttpTree,
  resolveBatchDeletePlan,
  type HttpTreeNode,
} from './httpapiTree'
import { ModalPortal } from '../../components/ModalPortal'
import { HttpFolderContextMenu, type HttpFolderContextMenuState } from './HttpFolderContextMenu'
import { HttpFolderModal } from './HttpFolderModal'
import { nodeEntryKey, buildSortedHttpApiTree } from './httpapiSort'
import type { HttpDragPayload, HttpDropTarget } from './httpapiSort'
import {
  HTTP_DROP_BEFORE_ATTR,
  HTTP_DROP_PARENT_ATTR,
  HTTP_FOLDER_DROP_ATTR,
  useHttpApiTreeDrag,
} from './useHttpApiTreeDrag'

interface Props {
  folders: HTTPFolder[]
  items: HTTPSavedRequest[]
  activeId: string
  filter: string
  onFilter: (q: string) => void
  onSelectApi: (item: HTTPSavedRequest) => void
  onCreateApi: (folderId: string) => void
  onRefresh: () => Promise<void>
  onContextApi: (e: React.MouseEvent, item: HTTPSavedRequest) => void
  onAfterBatchDelete?: (deletedApiIds: string[]) => void
  onTreeDrop?: (drag: HttpDragPayload, target: HttpDropTarget) => Promise<void>
}

/** HttpApiSidebar Apifox 式左侧接口目录树（拖拽排序/移入 + 目录管理）。 */
export function HttpApiSidebar({
  folders,
  items,
  activeId,
  filter,
  onFilter,
  onSelectApi,
  onCreateApi,
  onRefresh,
  onContextApi,
  onAfterBatchDelete,
  onTreeDrop,
}: Props) {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderModalParentId, setFolderModalParentId] = useState('')
  const [folderEdit, setFolderEdit] = useState<HTTPFolder | null>(null)
  const [folderCtx, setFolderCtx] = useState<HttpFolderContextMenuState | null>(null)
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<HTTPFolder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedFolders, setSelectedFolders] = useState<Record<string, boolean>>({})
  const [selectedApis, setSelectedApis] = useState<Record<string, boolean>>({})
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const filterActive = filter.trim().length > 0
  const fullTree = useMemo(() => buildSortedHttpApiTree(folders, items), [folders, items])
  const tree = useMemo(() => filterHttpTree(fullTree, filter), [fullTree, filter])

  const deletePlan = useMemo(
    () => resolveBatchDeletePlan(folders, items, selectedFolders, selectedApis),
    [folders, items, selectedFolders, selectedApis],
  )
  const selectionCount = useMemo(
    () => countBatchSelection(folders, items, selectedFolders, selectedApis),
    [folders, items, selectedFolders, selectedApis],
  )

  /** handleTreeDrop 拖拽投放后持久化布局。 */
  const handleTreeDrop = useCallback(
    async (drag: HttpDragPayload, target: HttpDropTarget) => {
      if (!onTreeDrop) return
      if (target.mode === 'into' && target.parentId) {
        setExpanded((m) => ({ ...m, [target.parentId]: true }))
      }
      await onTreeDrop(drag, target)
    },
    [onTreeDrop],
  )

  const {
    dragging,
    dragGhost,
    onFolderPointerDown,
    onApiPointerDown,
    shouldIgnoreTreeClick,
    isDropHighlightFolder,
    isDropHighlightRoot,
    isActiveDropSlot,
    isDragging,
  } = useHttpApiTreeDrag({
    batchMode: batchMode || filterActive,
    onDrop: handleTreeDrop,
  })

  const toggle = (id: string) => setExpanded((m) => ({ ...m, [id]: !m[id] }))

  /** openNewFolderModal 打开新建目录弹窗。 */
  const openNewFolderModal = (parentId = '') => {
    setFolderEdit(null)
    setFolderModalParentId(parentId)
    setFolderModalOpen(true)
  }

  /** exitBatchMode 退出批量模式并清空勾选。 */
  const exitBatchMode = () => {
    setBatchMode(false)
    setSelectedFolders({})
    setSelectedApis({})
    setDeleteConfirmOpen(false)
  }

  /** applySubtreeSelection 对子树统一勾选或取消。 */
  const applySubtreeSelection = (node: HttpTreeNode, on: boolean) => {
    const sub = collectHttpTreeSubtree(node)
    setSelectedFolders((m) => {
      const next = { ...m }
      for (const id of sub.folderIds) {
        if (on) next[id] = true
        else delete next[id]
      }
      return next
    })
    setSelectedApis((m) => {
      const next = { ...m }
      for (const id of sub.apiIds) {
        if (on) next[id] = true
        else delete next[id]
      }
      return next
    })
  }

  /** toggleFolderSelected 切换目录及其子树勾选。 */
  const toggleFolderSelected = (node: HttpTreeNode & { kind: 'folder' }) => {
    const checked = !!selectedFolders[node.id]
    applySubtreeSelection(node, !checked)
  }

  /** toggleApiSelected 切换单个接口勾选。 */
  const toggleApiSelected = (apiId: string) => {
    setSelectedApis((m) => {
      const next = { ...m }
      if (next[apiId]) delete next[apiId]
      else next[apiId] = true
      return next
    })
  }

  /** requestCreateApi 新建接口并展开目标目录。 */
  const requestCreateApi = (folderId: string) => {
    if (folderId) setExpanded((m) => ({ ...m, [folderId]: true }))
    onCreateApi(folderId)
  }

  /** runBatchDelete 执行批量删除（目录含子目录及目录内接口）。 */
  const runBatchDelete = async () => {
    const { folderIds, apiIds } = deletePlan
    if (folderIds.length === 0 && apiIds.length === 0) {
      setStatusMessage(t('httpapi.batchNone'))
      return
    }
    setDeleting(true)
    try {
      await api.batchDeleteHTTP(folderIds, apiIds)
      setStatusMessage(
        t('httpapi.batchDeleted', { folders: folderIds.length, apis: apiIds.length }),
      )
      onAfterBatchDelete?.(apiIds)
      exitBatchMode()
      await onRefresh()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  /** runDeleteFolder 删除单个目录（含子目录与接口）。 */
  const runDeleteFolder = async () => {
    const target = folderDeleteTarget
    if (!target) return
    setDeletingFolder(true)
    try {
      await api.deleteHTTPFolder(target.id)
      setStatusMessage(t('httpapi.folderDeleted'))
      setFolderDeleteTarget(null)
      await onRefresh()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setDeletingFolder(false)
    }
  }

  /** renderDropSlot 同级排序投放槽。 */
  const renderDropSlot = (parentId: string, beforeKey: string, depth: number) => {
    if (filterActive || batchMode) return null
    const active = isActiveDropSlot(parentId, beforeKey as '__end__')
    return (
      <li key={`slot-${parentId}-${beforeKey}`} className="httpapi-drop-slot-wrap" style={{ paddingLeft: 8 + depth * 14 }}>
        <div
          className={`httpapi-drop-slot${active ? ' is-active' : ''}`}
          {...{
            [HTTP_DROP_PARENT_ATTR]: parentId,
            [HTTP_DROP_BEFORE_ATTR]: beforeKey,
          }}
        />
      </li>
    )
  }

  /** renderNodeList 渲染子节点列表（含排序槽）。 */
  const renderNodeList = (parentId: string, nodes: HttpTreeNode[], depth: number) => (
    <ul className="httpapi-tree-children">
      {nodes.map((n) => (
        <Fragment key={n.kind === 'folder' ? `f-${n.id}` : `a-${n.item.id}`}>
          {renderDropSlot(parentId, nodeEntryKey(n), depth)}
          {renderNode(n, depth)}
        </Fragment>
      ))}
      {renderDropSlot(parentId, '__end__', depth)}
    </ul>
  )

  const renderNode = (node: HttpTreeNode, depth: number) => {
    if (node.kind === 'api') {
      const item = node.item
      const checked = !!selectedApis[item.id]
      const isDragSource = dragging?.kind === 'api' && dragging.id === item.id
      return (
        <li
          key={item.id}
          className={`httpapi-tree-api${!batchMode && !isDragging && item.id === activeId ? ' is-active' : ''}${batchMode && checked ? ' is-batch-selected' : ''}${isDragSource ? ' is-drag-source' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onPointerDown={(e) =>
            onApiPointerDown(item.id, { label: item.name, method: item.method || 'GET' }, e)
          }
          onClick={() => {
            if (shouldIgnoreTreeClick()) return
            if (batchMode) toggleApiSelected(item.id)
            else onSelectApi(item)
          }}
          onContextMenu={(e) => !batchMode && onContextApi(e, item)}
        >
          {batchMode && (
            <input
              type="checkbox"
              className="httpapi-tree-check"
              checked={checked}
              onChange={() => toggleApiSelected(item.id)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <span className={`httpapi-method-tag method-${(item.method || 'GET').toLowerCase()}`}>
            {(item.method || 'GET').slice(0, 3)}
          </span>
          <span className="httpapi-tree-label">{item.name}</span>
        </li>
      )
    }
    const open = expanded[node.id] !== false
    const checked = !!selectedFolders[node.id]
    const isDragSource = dragging?.kind === 'folder' && dragging.id === node.id
    const dropHighlight = !batchMode && isDropHighlightFolder(node.id)
    return (
      <li
        key={node.id}
        className={`httpapi-tree-folder-wrap${dropHighlight ? ' is-drop-target' : ''}${isDragSource ? ' is-drag-source' : ''}`}
        {...{ [HTTP_FOLDER_DROP_ATTR]: node.id }}
      >
        <div
          className={`httpapi-tree-folder${batchMode && checked ? ' is-batch-selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onPointerDown={(e) => onFolderPointerDown(node.id, node.name, e)}
          onClick={() => {
            if (shouldIgnoreTreeClick()) return
            if (batchMode) toggleFolderSelected(node)
            else toggle(node.id)
          }}
          onContextMenu={(e) => {
            if (batchMode) return
            e.preventDefault()
            setFolderCtx({ x: e.clientX, y: e.clientY, folder: folders.find((f) => f.id === node.id)! })
          }}
        >
          {batchMode ? (
            <>
              <span
                className="httpapi-tree-chevron"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(node.id)
                }}
              >
                {open ? '▾' : '▸'}
              </span>
              <input
                type="checkbox"
                className="httpapi-tree-check"
                checked={checked}
                onChange={() => toggleFolderSelected(node)}
                onClick={(e) => e.stopPropagation()}
              />
            </>
          ) : (
            <span className="httpapi-tree-chevron">{open ? '▾' : '▸'}</span>
          )}
          <span className="httpapi-tree-folder-icon">📁</span>
          <span className="httpapi-tree-label">{node.name}</span>
          {!batchMode && (
            <button
              type="button"
              className="httpapi-tree-add-api"
              title={t('httpapi.newRequest')}
              onClick={(e) => {
                e.stopPropagation()
                requestCreateApi(node.id)
              }}
            >
              +
            </button>
          )}
        </div>
        {open && node.children.length > 0 && renderNodeList(node.id, node.children, depth + 1)}
      </li>
    )
  }

  const canBatch = folders.length > 0 || items.length > 0

  return (
    <aside className="app-sidebar httpapi-sidebar">
      <div className="httpapi-tree-toolbar">
        <input
          className="wn-input wn-input-sm"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={t('httpapi.filterPlaceholder')}
          disabled={batchMode}
        />
      </div>
      <div className={`httpapi-tree-action-bar${batchMode ? ' is-batch' : ''}`}>
        {batchMode ? (
          <>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost httpapi-tree-action-btn"
              disabled={tree.length === 0}
              onClick={() => {
                const all = collectHttpTreeAll(tree)
                const folderMap: Record<string, boolean> = {}
                const apiMap: Record<string, boolean> = {}
                for (const id of all.folderIds) folderMap[id] = true
                for (const id of all.apiIds) apiMap[id] = true
                setSelectedFolders(folderMap)
                setSelectedApis(apiMap)
              }}
            >
              {t('httpapi.batchSelectAll')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost httpapi-tree-action-btn"
              disabled={selectionCount.total === 0}
              onClick={() => {
                setSelectedFolders({})
                setSelectedApis({})
              }}
            >
              {t('httpapi.batchClear')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-danger httpapi-tree-action-btn"
              disabled={selectionCount.total === 0 || deleting}
              onClick={() => {
                if (selectionCount.total === 0) {
                  setStatusMessage(t('httpapi.batchNone'))
                  return
                }
                setDeleteConfirmOpen(true)
              }}
            >
              {t('httpapi.batchDelete', { count: selectionCount.total })}
            </button>
            <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost httpapi-tree-action-btn" onClick={exitBatchMode}>
              {t('httpapi.batchExit')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost httpapi-tree-action-btn"
              title={t('httpapi.newFolder')}
              onClick={() => openNewFolderModal('')}
            >
              {t('httpapi.newFolder')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost httpapi-tree-action-btn"
              title={t('httpapi.newRequest')}
              onClick={() => requestCreateApi('')}
            >
              <IconPlus size={12} /> {t('httpapi.newRequest')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost httpapi-tree-action-btn"
              title={t('httpapi.batch')}
              disabled={!canBatch}
              onClick={() => {
                if (!canBatch) {
                  setStatusMessage(t('httpapi.batchEmpty'))
                  return
                }
                setBatchMode(true)
                setSelectedFolders({})
                setSelectedApis({})
              }}
            >
              {t('httpapi.batch')}
            </button>
          </>
        )}
      </div>
      <div
        className={`sidebar-body httpapi-tree-body${isDropHighlightRoot() && isDragging ? ' is-drop-root' : ''}`}
        {...{ [HTTP_FOLDER_DROP_ATTR]: '' }}
      >
        {isDragging && !filterActive && (
          <div className="httpapi-tree-drop-hint">{t('httpapi.dragTreeHint')}</div>
        )}
        {tree.length === 0 ? (
          <div className="empty-hint">{filter ? t('httpapi.noFilterMatch') : t('httpapi.emptyList')}</div>
        ) : (
          <ul className="httpapi-tree">
            {tree.map((n) => (
              <Fragment key={n.kind === 'folder' ? `f-${n.id}` : `a-${n.item.id}`}>
                {renderDropSlot('', nodeEntryKey(n), 0)}
                {renderNode(n, 0)}
              </Fragment>
            ))}
            {renderDropSlot('', '__end__', 0)}
          </ul>
        )}
      </div>

      <HttpFolderModal
        open={folderModalOpen}
        parentId={folderModalParentId}
        folder={folderEdit}
        folders={folders}
        items={items}
        onClose={() => {
          setFolderModalOpen(false)
          setFolderEdit(null)
        }}
        onSaved={() => void onRefresh()}
      />

      {folderCtx && (
        <HttpFolderContextMenu
          menu={folderCtx}
          onClose={() => setFolderCtx(null)}
          onNewSubfolder={(f) => openNewFolderModal(f.id)}
          onRename={(f) => {
            setFolderEdit(f)
            setFolderModalParentId('')
            setFolderModalOpen(true)
          }}
          onNewApi={(folderId) => requestCreateApi(folderId)}
          onDelete={(f) => setFolderDeleteTarget(f)}
        />
      )}

      {dragGhost && (
        <ModalPortal>
          <div
            className={`httpapi-drag-ghost${dragGhost.kind === 'folder' ? ' is-folder' : ''}`}
            style={{ left: dragGhost.x, top: dragGhost.y }}
            aria-hidden
          >
            {dragGhost.kind === 'api' && dragGhost.method ? (
              <span className={`httpapi-method-tag method-${dragGhost.method.toLowerCase()}`}>
                {dragGhost.method.slice(0, 3)}
              </span>
            ) : (
              <span className="httpapi-tree-folder-icon">📁</span>
            )}
            <span className="httpapi-drag-ghost-label">{dragGhost.label}</span>
          </div>
        </ModalPortal>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('httpapi.batchDeleteTitle')}
        message={t('httpapi.batchDeleteMsg', {
          folders: deletePlan.folderIds.length,
          apis: deletePlan.apiIds.length,
        })}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void runBatchDelete()}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={!!folderDeleteTarget}
        title={t('httpapi.deleteFolderTitle')}
        message={t('httpapi.deleteFolderMsg', { name: folderDeleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void runDeleteFolder()}
        onCancel={() => setFolderDeleteTarget(null)}
      />
    </aside>
  )
}

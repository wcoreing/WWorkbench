import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DockerContainer, DockerContext, DockerImage, SSHHost } from '../../api/types'
import { IconDocker, IconPlus } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DockerContextModal } from '../../features/docker/DockerContextModal'
import { useAppStore } from '../../stores/appStore'
import { APP_SETTING_KEYS, saveAppSetting } from '../../stores/appPreferences'
import {
  loadDockerWorkspace,
  scheduleDockerWorkspacePersist,
  toDockerWorkspaceSnapshot,
  type DockerView,
} from '../../stores/dockerWorkspacePersist'

const LOCAL_CONTEXT = 'local'
const PAGE_SIZE = 20

/** canDeleteDockerContext 是否允许删除（本地默认上下文不可删）。 */
function canDeleteDockerContext(ctx: DockerContext | undefined): boolean {
  if (!ctx) return false
  return ctx.id !== LOCAL_CONTEXT && ctx.kind !== 'local'
}

const DEFAULT_LOCAL_CONTEXT: DockerContext = {
  id: LOCAL_CONTEXT,
  name: '本地 Docker',
  kind: 'local',
  endpoint: 'unix:///var/run/docker.sock',
  connected: false,
}

/** formatUptime 格式化容器运行时长。 */
function formatUptime(state: string, createdAt: number): string {
  if (state !== 'running' || !createdAt) return '-'
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - createdAt))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

/** formatImageSize 格式化镜像大小。 */
function formatImageSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/** formatImageShort 截断展示镜像名。 */
function formatImageShort(image: string, max = 32): string {
  if (!image) return '-'
  if (image.length <= max) return image
  if (image.startsWith('sha256:')) {
    return `${image.slice(0, 18)}…`
  }
  const head = Math.max(8, max - 1)
  return `${image.slice(0, head)}…`
}

interface DockerImageCellProps {
  image: string
  onCopied: () => void
}

/** DockerImageCell 镜像名单元格（截断 + 复制）。 */
function DockerImageCell({ image, onCopied }: DockerImageCellProps) {
  const copyImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(image).then(onCopied)
  }

  return (
    <div className="docker-image-cell">
      <span className="docker-image-text" title={image}>
        {formatImageShort(image)}
      </span>
      <button
        type="button"
        className="docker-copy-btn"
        title={`复制：${image}`}
        onClick={copyImage}
      >
        复制
      </button>
    </div>
  )
}

interface DockerListBarProps {
  page: number
  total: number
  pageSize: number
  loading?: boolean
  acting?: boolean
  onPageChange: (page: number) => void
  onRefresh: () => void
}

/** DockerListBar 列表工具栏（刷新 + 分页）。 */
function DockerListBar({
  page,
  total,
  pageSize,
  loading,
  acting,
  onPageChange,
  onRefresh,
}: DockerListBarProps) {
  const totalPages = Math.max(1, Math.ceil(Math.max(total, 1) / pageSize))
  const canPrev = total > 0 && page > 1
  const canNext = total > 0 && page < totalPages

  return (
    <div className="pane-toolbar docker-list-bar">
      <div className="pane-toolbar-start">
        <button
          type="button"
          className="wn-btn wn-btn-tool wn-btn-sm"
          disabled={loading || acting}
          onClick={onRefresh}
        >
          刷新
        </button>
        <span className="pane-meta">
          {total > 0 ? `共 ${total} 条 · 第 ${page}/${totalPages} 页` : '暂无数据'}
          {loading ? ' · 加载中…' : ''}
        </span>
      </div>
      {total > 0 && (
        <div className="pane-toolbar-end">
          <button
            type="button"
            className="wn-btn wn-btn-tool wn-btn-sm"
            disabled={!canPrev || loading}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-tool wn-btn-sm"
            disabled={!canNext || loading}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

/** paginateList 对列表分页切片。 */
function paginateList<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
  }
}

/** mayHaveDatabase 启发式判断容器是否可能暴露数据库端口。 */
function mayHaveDatabase(c: DockerContainer): boolean {
  const img = c.image.toLowerCase()
  if (img.includes('mysql') || img.includes('mariadb') || img.includes('postgres')) return true
  return c.ports.includes('3306') || c.ports.includes('5432') || c.ports.includes('3307')
}

/** clampPage 将页码限制在有效范围。 */
function clampPage(page: number, total: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(1, page), totalPages)
}

/** DockerWorkbench Docker 容器与镜像管理工作区。 */
export function DockerWorkbench() {
  const { setStatusMessage, setActiveProduct, setProductLink, productLink, statusMessage } = useAppStore()
  const [contexts, setContexts] = useState<DockerContext[]>([DEFAULT_LOCAL_CONTEXT])
  const [activeContextId, setActiveContextId] = useState(LOCAL_CONTEXT)
  const [view, setView] = useState<DockerView>('containers')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const [sshHosts, setSSHHosts] = useState<SSHHost[]>([])
  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [contextModalHostId, setContextModalHostId] = useState<string | undefined>()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; container: DockerContainer } | null>(null)
  const [contextCtxMenu, setContextCtxMenu] = useState<{ x: number; y: number; context: DockerContext } | null>(null)
  const [confirmState, setConfirmState] = useState<
    | { type: 'context'; ctx: DockerContext }
    | { type: 'container'; container: DockerContainer }
    | null
  >(null)
  const [containerPage, setContainerPage] = useState(1)
  const [imagePage, setImagePage] = useState(1)
  const workspaceLoaded = useRef(false)

  const activeContext = contexts.find((c) => c.id === activeContextId)
  const selected = containers.find((c) => c.id === selectedId) ?? null
  const dockerReady = Boolean(activeContext?.connected)
  const isRemoteContext = activeContext != null && activeContext.id !== LOCAL_CONTEXT
  const canDeleteActiveContext = canDeleteDockerContext(activeContext)

  const pagedContainers = useMemo(
    () => paginateList(containers, containerPage, PAGE_SIZE),
    [containers, containerPage]
  )
  const pagedImages = useMemo(() => paginateList(images, imagePage, PAGE_SIZE), [images, imagePage])

  const refreshContexts = useCallback(async () => {
    try {
      const list = await api.listDockerContexts()
      setContexts(list)
      setActiveContextId((current) => (list.some((c) => c.id === current) ? current : LOCAL_CONTEXT))
    } catch (e) {
      setContexts([{ ...DEFAULT_LOCAL_CONTEXT, connected: false }])
      setActiveContextId(LOCAL_CONTEXT)
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage])

  const loadLogs = useCallback(async (contextId: string, containerId: string) => {
    try {
      const content = await api.getContainerLogs(contextId, containerId, 300)
      setLogs(content || '（无日志）')
    } catch (e) {
      setLogs((e as Error).message)
    }
  }, [])

  const refreshData = useCallback(async () => {
    if (!activeContextId) return
    setLoading(true)
    try {
      await api.testDockerContext(activeContextId)
      setContexts((prev) =>
        prev.map((c) => (c.id === activeContextId ? { ...c, connected: true } : c))
      )
      if (view === 'images') {
        const list = await api.listImages(activeContextId)
        setImages(list)
        setImagePage((p) => clampPage(p, list.length, PAGE_SIZE))
        setStatusMessage(`已加载 ${list.length} 个镜像`)
        return
      }
      const list = await api.listContainers(activeContextId)
      setContainers(list)
      setContainerPage((p) => clampPage(p, list.length, PAGE_SIZE))
      if (selectedId && list.some((c) => c.id === selectedId)) {
        await loadLogs(activeContextId, selectedId)
      } else {
        setSelectedId(list[0]?.id ?? null)
        if (list[0]) await loadLogs(activeContextId, list[0].id)
        else setLogs('')
      }
      setStatusMessage(`已加载 ${list.length} 个容器`)
    } catch (e) {
      setContainers([])
      setImages([])
      setLogs('')
      setContexts((prev) =>
        prev.map((c) => (c.id === activeContextId ? { ...c, connected: false } : c))
      )
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeContextId, view, selectedId, loadLogs, setStatusMessage])

  useEffect(() => {
    if (workspaceLoaded.current) return
    workspaceLoaded.current = true
    void (async () => {
      const snap = await loadDockerWorkspace()
      if (snap?.activeContextId) setActiveContextId(snap.activeContextId)
      if (snap?.view) setView(snap.view)
    })()
  }, [])

  useEffect(() => {
    scheduleDockerWorkspacePersist(toDockerWorkspaceSnapshot(activeContextId, view))
    void saveAppSetting(APP_SETTING_KEYS.lastDockerContextId, activeContextId)
  }, [activeContextId, view])

  useEffect(() => {
    void refreshContexts()
    void api.listSSHHosts().then(setSSHHosts).catch(() => setSSHHosts([]))
  }, [refreshContexts])

  useEffect(() => {
    if (!activeContextId) return
    void refreshData()
  }, [activeContextId, view])

  useEffect(() => {
    setContainerPage(1)
    setImagePage(1)
  }, [activeContextId, view])

  useEffect(() => {
    if (!productLink || productLink.action !== 'docker-context') return
    const { hostId } = productLink
    setProductLink(null)
    setActiveProduct('docker')
    setContextModalHostId(hostId)
    setContextModalOpen(true)
    if (hostId) setStatusMessage('从 SSH 主机添加远程 Docker 上下文')
  }, [productLink, setProductLink, setActiveProduct, setStatusMessage])

  useEffect(() => {
    if (!ctxMenu && !contextCtxMenu) return
    const close = () => {
      setCtxMenu(null)
      setContextCtxMenu(null)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu, contextCtxMenu])

  const selectContainer = async (container: DockerContainer) => {
    setSelectedId(container.id)
    await loadLogs(activeContextId, container.id)
  }

  /** runContainerAction 对指定容器执行操作。 */
  const runContainerAction = async (
    container: DockerContainer,
    label: string,
    fn: () => Promise<void>
  ) => {
    if (acting) return
    setActing(true)
    setStatusMessage(label)
    try {
      await fn()
      setSelectedId(container.id)
      await refreshData()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  const startContainer = (container: DockerContainer) =>
    runContainerAction(container, `正在启动 ${container.name || container.shortId}…`, async () => {
      await api.startContainer(activeContextId, container.id)
    })

  const stopContainer = (container: DockerContainer) =>
    runContainerAction(container, `正在停止 ${container.name || container.shortId}…`, async () => {
      await api.stopContainer(activeContextId, container.id)
    })

  const restartContainer = (container: DockerContainer) =>
    runContainerAction(container, `正在重启 ${container.name || container.shortId}…`, async () => {
      await api.restartContainer(activeContextId, container.id)
    })

  const removeContainer = (container: DockerContainer) => {
    if (acting) return
    setConfirmState({ type: 'container', container })
  }

  /** performRemoveContainer 确认后删除容器。 */
  const performRemoveContainer = async (container: DockerContainer) => {
    const name = container.name || container.shortId
    setActing(true)
    setStatusMessage(`正在删除 ${name}…`)
    try {
      await api.removeContainer(activeContextId, container.id)
      if (selectedId === container.id) {
        setSelectedId(null)
        setLogs('')
      }
      await refreshData()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  const openContainerShell = async (container: DockerContainer) => {
    if (container.state !== 'running') return
    setStatusMessage('正在准备容器终端…')
    try {
      const shell = await api.getContainerShell(activeContextId, container.id)
      setActiveProduct('terminal')
      if (shell.mode === 'local') {
        setProductLink({
          action: 'terminal',
          localShell: true,
          initialCommand: `${shell.command}\r`,
        })
      } else {
        setProductLink({
          action: 'terminal',
          hostId: shell.hostId,
          initialCommand: `${shell.command}\r`,
        })
      }
      setStatusMessage(`正在打开终端 · ${container.name || container.shortId}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const openDatabaseLink = async (container: DockerContainer) => {
    setStatusMessage('正在解析数据库端口…')
    try {
      const link = await api.resolveContainerDatabaseLink(activeContextId, container.id)
      setActiveProduct('database')
      setProductLink({
        action: 'database',
        connectionDraft: {
          name: link.name,
          group: 'Docker',
          dbType: link.dbType,
          host: link.host,
          port: link.port,
          user: link.user,
          sshEnabled: link.sshEnabled,
          sshHostId: link.sshHostId,
        },
      })
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const openContainerContextMenu = (e: React.MouseEvent, container: DockerContainer) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, container })
  }

  /** requestDeleteDockerContext 打开删除确认弹窗。 */
  const requestDeleteDockerContext = (ctx: DockerContext) => {
    if (!canDeleteDockerContext(ctx)) return
    setContextCtxMenu(null)
    setConfirmState({ type: 'context', ctx })
  }

  /** performDeleteDockerContext 确认后删除远程上下文。 */
  const performDeleteDockerContext = async (ctx: DockerContext) => {
    try {
      await api.deleteDockerContext(ctx.id)
      setContainers([])
      setImages([])
      setLogs('')
      setSelectedId(null)
      if (activeContextId === ctx.id) {
        setActiveContextId(LOCAL_CONTEXT)
      }
      await refreshContexts()
      setStatusMessage(`已删除 ${ctx.name}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** handleConfirmDialog 处理确认弹窗确定。 */
  const handleConfirmDialog = () => {
    const pending = confirmState
    setConfirmState(null)
    if (!pending) return
    if (pending.type === 'context') {
      void performDeleteDockerContext(pending.ctx)
      return
    }
    void performRemoveContainer(pending.container)
  }

  const toolbarStatus = useMemo(() => {
    if (!activeContext) return '未连接'
    if (!dockerReady) return 'Docker 未运行'
    if (view === 'images') return `${images.length} 个镜像`
    if (selected) return `${selected.name || selected.shortId} · ${selected.state}`
    return `${containers.length} 个容器`
  }, [activeContext, dockerReady, view, selected, images.length, containers.length])

  const confirmDialogProps = useMemo(() => {
    if (!confirmState) return null
    if (confirmState.type === 'context') {
      return {
        title: '删除 Docker 上下文',
        message: `确定删除「${confirmState.ctx.name}」？此操作不可恢复。`,
      }
    }
    const name = confirmState.container.name || confirmState.container.shortId
    return {
      title: '删除容器',
      message: `确定删除「${name}」？此操作不可恢复。`,
    }
  }, [confirmState])

  const stopRowClick = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="product-workbench docker-workbench">
      <div className="product-body">
        <aside className="app-sidebar docker-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>Docker 上下文</span>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-sm"
                title="添加远程 Docker"
                onClick={() => {
                  setContextModalHostId(undefined)
                  setContextModalOpen(true)
                }}
              >
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              <ul className="conn-list">
                {contexts.map((ctx) => (
                  <li
                    key={ctx.id}
                    className={`conn-item docker-context-item ${ctx.id === activeContextId ? 'active' : ''} ${ctx.connected ? 'connected' : ''}`}
                    onClick={() => setActiveContextId(ctx.id)}
                    onContextMenu={(e) => {
                      if (!canDeleteDockerContext(ctx)) return
                      e.preventDefault()
                      e.stopPropagation()
                      setContextCtxMenu({ x: e.clientX, y: e.clientY, context: ctx })
                    }}
                  >
                    <IconDocker size={14} className="mock-icon" />
                    <div className="conn-meta">
                      <span className="conn-name">{ctx.name}</span>
                      <span className="conn-host">{ctx.endpoint}</span>
                    </div>
                    {canDeleteDockerContext(ctx) && (
                      <button
                        type="button"
                        className="wn-btn wn-btn-text-danger docker-context-item-del"
                        title="删除上下文"
                        onClick={(e) => {
                          e.stopPropagation()
                          requestDeleteDockerContext(ctx)
                        }}
                      >
                        删除
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canDeleteActiveContext && (
                <button
                  type="button"
                  className="wn-btn wn-btn-tool wn-btn-sm docker-context-del"
                  onClick={() => activeContext && requestDeleteDockerContext(activeContext)}
                >
                  删除当前上下文
                </button>
              )}
              {contexts.some(canDeleteDockerContext) && (
                <div className="empty-hint mock-hint">远程上下文：悬停删除 · 右键菜单</div>
              )}
            </div>
          </section>
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>视图</span>
            </div>
            <div className="sidebar-body docker-views">
              <button
                type="button"
                className={`docker-view-btn ${view === 'containers' ? 'active' : ''}`}
                onClick={() => setView('containers')}
              >
                容器
              </button>
              <button
                type="button"
                className={`docker-view-btn ${view === 'images' ? 'active' : ''}`}
                onClick={() => setView('images')}
              >
                镜像
              </button>
              <button type="button" className="docker-view-btn" disabled title="后续版本开放">
                Compose
              </button>
              <button type="button" className="docker-view-btn" disabled title="后续版本开放">
                卷
              </button>
            </div>
          </section>
        </aside>

        <main className="app-main docker-main">
          <div className="editor-chrome">
            <div className="wn-tabs">
              <button type="button" className="wn-tab wn-tab-docker active">
                <span className="tab-dot" />
                <span className="tab-title">{view === 'images' ? '镜像' : '容器'}</span>
              </button>
            </div>
            <span className="chrome-spacer" />
            <span className="docker-chrome-status" title={toolbarStatus}>
              <span className={`status-dot ${dockerReady ? 'online' : ''}`} />
              <span>{toolbarStatus}</span>
            </span>
          </div>

          {!dockerReady && !loading ? (
            <div className="pane-empty docker-empty">
              <span>无法连接 Docker 引擎</span>
              <span className="docker-empty-hint">
                {statusMessage && statusMessage !== '就绪'
                  ? statusMessage
                  : isRemoteContext
                    ? '请确认 SSH 可达，远端 Docker 已启动，且当前用户可访问 docker.sock（如在 docker 组）'
                    : '请确认 Docker Desktop 已启动。将尝试：~/.docker/run/docker.sock、/var/run/docker.sock'}
              </span>
              <button
                type="button"
                className="wn-btn wn-btn-tool wn-btn-sm"
                onClick={() => void refreshData()}
                disabled={loading}
              >
                重试连接
              </button>
            </div>
          ) : view === 'images' ? (
            <div className="docker-list-panel">
              <DockerListBar
                page={pagedImages.page}
                total={images.length}
                pageSize={PAGE_SIZE}
                loading={loading}
                acting={acting}
                onPageChange={setImagePage}
                onRefresh={() => void refreshData()}
              />
              <div className="docker-table-wrap docker-table-full">
                <table className="docker-table docker-table-images">
                <thead>
                  <tr>
                    <th>标签</th>
                    <th>ID</th>
                    <th>大小</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {images.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="grid-empty">
                        {loading ? '加载中…' : '无镜像'}
                      </td>
                    </tr>
                  ) : (
                    pagedImages.items.map((img) => (
                      <tr key={img.id} className="docker-row">
                        <td className="docker-col-image">
                          <DockerImageCell
                            image={img.tags}
                            onCopied={() => setStatusMessage('已复制镜像标签')}
                          />
                        </td>
                        <td className="docker-mono">{img.shortId}</td>
                        <td>{formatImageSize(img.size)}</td>
                        <td>{img.createdAt ? new Date(img.createdAt * 1000).toLocaleString() : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <div className="docker-layout">
              <div className="docker-list-panel docker-list-panel-containers">
                <DockerListBar
                  page={pagedContainers.page}
                  total={containers.length}
                  pageSize={PAGE_SIZE}
                  loading={loading}
                  acting={acting}
                  onPageChange={setContainerPage}
                  onRefresh={() => void refreshData()}
                />
                <div className="docker-table-wrap">
                <table className="docker-table docker-table-containers">
                  <colgroup>
                    <col className="docker-col-name" />
                    <col className="docker-col-image" />
                    <col className="docker-col-state" />
                    <col className="docker-col-ports" />
                    <col className="docker-col-uptime" />
                    <col className="docker-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>镜像</th>
                      <th>状态</th>
                      <th>端口</th>
                      <th>运行时长</th>
                      <th className="docker-th-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="grid-empty">
                          {loading ? '加载中…' : '无容器'}
                        </td>
                      </tr>
                    ) : (
                      pagedContainers.items.map((c) => {
                        const running = c.state === 'running'
                        return (
                          <tr
                            key={c.id}
                            className={`docker-row ${c.id === selectedId ? 'selected' : ''}`}
                            onClick={() => void selectContainer(c)}
                            onContextMenu={(e) => openContainerContextMenu(e, c)}
                          >
                            <td className="docker-name docker-ellipsis" title={c.name || c.shortId}>
                              {c.name || c.shortId}
                            </td>
                            <td className="docker-col-image">
                              <DockerImageCell
                                image={c.image}
                                onCopied={() => setStatusMessage('已复制镜像名')}
                              />
                            </td>
                            <td>
                              <span className={`docker-status docker-status-${c.state}`}>{c.state}</span>
                            </td>
                            <td className="docker-mono docker-ellipsis" title={c.ports}>
                              {c.ports}
                            </td>
                            <td className="docker-col-uptime">{formatUptime(c.state, c.createdAt)}</td>
                            <td className="docker-col-actions" onClick={stopRowClick}>
                              <div className="docker-row-actions">
                                {!running && (
                                  <button
                                    type="button"
                                    className="docker-act-btn"
                                    disabled={!dockerReady || acting}
                                    title="启动"
                                    onClick={() => void startContainer(c)}
                                  >
                                    启动
                                  </button>
                                )}
                                {running && (
                                  <>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title="停止"
                                      onClick={() => void stopContainer(c)}
                                    >
                                      停止
                                    </button>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title="重启"
                                      onClick={() => void restartContainer(c)}
                                    >
                                      重启
                                    </button>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title="终端"
                                      onClick={() => void openContainerShell(c)}
                                    >
                                      终端
                                    </button>
                                  </>
                                )}
                                {mayHaveDatabase(c) && (
                                  <button
                                    type="button"
                                    className="docker-act-btn accent"
                                    disabled={!dockerReady || acting}
                                    title="用数据库打开"
                                    onClick={() => void openDatabaseLink(c)}
                                  >
                                    数据库
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="docker-act-btn danger"
                                  disabled={!dockerReady || acting}
                                  title="删除"
                                  onClick={() => void removeContainer(c)}
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>
              <div className="docker-log-panel">
                <header className="docker-log-header">
                  <span>日志 · {selected?.name || selected?.shortId || '—'}</span>
                  {selected && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-tool wn-btn-sm"
                      onClick={() => void loadLogs(activeContextId, selected.id)}
                      disabled={acting}
                    >
                      刷新日志
                    </button>
                  )}
                </header>
                <pre className="docker-log-body">{logs || (loading ? '加载中…' : '选择容器查看日志')}</pre>
              </div>
            </div>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={confirmState != null}
        title={confirmDialogProps?.title ?? '确认'}
        message={confirmDialogProps?.message}
        confirmLabel="删除"
        danger
        onConfirm={handleConfirmDialog}
        onCancel={() => setConfirmState(null)}
      />

      <DockerContextModal
        open={contextModalOpen}
        hosts={sshHosts}
        initialHostId={contextModalHostId}
        onClose={() => {
          setContextModalOpen(false)
          setContextModalHostId(undefined)
        }}
        onSaved={() => void refreshContexts()}
      />

      {contextCtxMenu && (
        <div
          className="wn-context-menu"
          style={{ left: contextCtxMenu.x, top: contextCtxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item danger"
            onClick={() => requestDeleteDockerContext(contextCtxMenu.context)}
          >
            删除上下文
          </button>
        </div>
      )}

      {ctxMenu && (
        <div
          className="wn-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {mayHaveDatabase(ctxMenu.container) && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                setCtxMenu(null)
                void openDatabaseLink(ctxMenu.container)
              }}
            >
              用数据库打开
            </button>
          )}
          {ctxMenu.container.state === 'running' && (
            <button
              type="button"
              className="wn-context-item"
              onClick={() => {
                setCtxMenu(null)
                void openContainerShell(ctxMenu.container)
              }}
            >
              进入终端
            </button>
          )}
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              void navigator.clipboard.writeText(ctxMenu.container.image)
              setStatusMessage('已复制镜像名')
              setCtxMenu(null)
            }}
          >
            复制镜像名
          </button>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { ContainerEnvVar, DockerContainer, DockerContext, DockerImage, SSHHost } from '../../api/types'
import { IconDocker, IconPlus } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { DockerContextModal } from '../../features/docker/DockerContextModal'
import { DockerComposePanel } from '../../features/docker/DockerComposePanel'
import { DockerRunModal } from '../../features/docker/DockerRunModal'
import { READY_MESSAGES, useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildDockerSurface } from '../../stores/agentSurface'
import { openAgentDraft, mentionSSH } from '../../features/agent/openAgentDraft'
import { openTerminal, openSftp, openDatabase, openNotebook, openLogs, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { APP_SETTING_KEYS, saveAppSetting } from '../../stores/appPreferences'
import { pressProps, useDismissOverlays } from '../../components/compat'
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
  name: 'Local Docker',
  kind: 'local',
  endpoint: 'unix:///var/run/docker.sock',
  connected: false,
}

/** contextDisplayName 本地化上下文显示名。 */
function contextDisplayName(ctx: DockerContext, localLabel: string) {
  if (ctx.id === LOCAL_CONTEXT && ctx.kind === 'local') return localLabel
  return ctx.name
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

/** primaryImageTag 取镜像第一个可用标签。 */
function primaryImageTag(tags: string): string {
  if (!tags || tags === '<none>') return ''
  return tags.split(',')[0]?.trim() || tags
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
  const { t } = useI18n()

  return (
    <div className="docker-image-cell">
      <span className="docker-image-text" title={image}>
        {formatImageShort(image)}
      </span>
      <button
        type="button"
        className="docker-copy-btn"
        title={t('docker.copyTitle', { image })}
        {...pressProps(
          () => {
            void navigator.clipboard.writeText(image).then(onCopied)
          },
          { stop: true },
        )}
      >
        {t('common.copy')}
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
  const { t } = useI18n()
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
          {...pressProps(onRefresh, { disabled: loading || acting })}
        >
          {t('common.refresh')}
        </button>
        <span className="pane-meta">
          {total > 0
            ? t('common.listMeta', { total, page, totalPages })
            : t('common.noData')}
          {loading ? ` · ${t('common.loading')}` : ''}
        </span>
      </div>
      {total > 0 && (
        <div className="pane-toolbar-end">
          <button
            type="button"
            className="wn-btn wn-btn-tool wn-btn-sm"
            disabled={!canPrev || loading}
            {...pressProps(() => onPageChange(page - 1), { disabled: !canPrev || loading })}
          >
            {t('common.prevPage')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-tool wn-btn-sm"
            disabled={!canNext || loading}
            {...pressProps(() => onPageChange(page + 1), { disabled: !canNext || loading })}
          >
            {t('common.nextPage')}
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
  const { setStatusMessage, setActiveProduct, statusMessage, setAgentSurface, activeProduct } = useAppStore()
  const { t } = useI18n()
  const [contexts, setContexts] = useState<DockerContext[]>([DEFAULT_LOCAL_CONTEXT])
  const [activeContextId, setActiveContextId] = useState(LOCAL_CONTEXT)
  const [view, setView] = useState<DockerView>('containers')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [containerEnv, setContainerEnv] = useState<ContainerEnvVar[]>([])
  const [detailTab, setDetailTab] = useState<'logs' | 'env'>('logs')
  const [envLoading, setEnvLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const [sshHosts, setSSHHosts] = useState<SSHHost[]>([])
  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [contextModalHostId, setContextModalHostId] = useState<string | undefined>()
  const [runModalImage, setRunModalImage] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; container: DockerContainer } | null>(null)
  const [contextCtxMenu, setContextCtxMenu] = useState<{ x: number; y: number; context: DockerContext } | null>(null)
  useDismissOverlays(() => {
    setCtxMenu(null)
    setContextCtxMenu(null)
  })
  const [confirmState, setConfirmState] = useState<
    | { type: 'context'; ctx: DockerContext }
    | { type: 'container'; container: DockerContainer }
    | null
  >(null)
  const [containerPage, setContainerPage] = useState(1)
  const [imagePage, setImagePage] = useState(1)
  const [composeProjectDir, setComposeProjectDir] = useState('')
  const workspaceLoaded = useRef(false)

  const activeContext = contexts.find((c) => c.id === activeContextId)
  const selected = containers.find((c) => c.id === selectedId) ?? null
  const dockerReady = Boolean(activeContext?.connected)
  const isRemoteContext = activeContext != null && activeContext.id !== LOCAL_CONTEXT

  useEffect(() => {
    if (activeProduct !== 'docker') return
    setAgentSurface(
      buildDockerSurface({
        contextId: activeContextId,
        contextLabel: activeContext ? contextDisplayName(activeContext, t('docker.localContext')) : activeContextId,
        view,
        containerId: selected?.id,
        containerName: selected?.name || selected?.shortId,
        containerState: selected?.state,
        composeDir: composeProjectDir,
        imageCount: images.length,
        openTabsBrief: `${view} · ${containers.length} containers · ${images.length} images`,
      }),
    )
  }, [
    activeProduct,
    activeContextId,
    activeContext,
    view,
    selected,
    composeProjectDir,
    images.length,
    containers.length,
    setAgentSurface,
    t,
  ])

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
      setLogs(content || t('docker.noLogs'))
    } catch (e) {
      setLogs((e as Error).message)
    }
  }, [t])

  /** loadContainerEnv 加载容器启动环境变量。 */
  const loadContainerEnv = useCallback(async (contextId: string, containerId: string) => {
    setEnvLoading(true)
    try {
      const env = await api.getContainerEnv(contextId, containerId)
      setContainerEnv(env?.vars ?? [])
    } catch (e) {
      setContainerEnv([])
      setStatusMessage((e as Error).message)
    } finally {
      setEnvLoading(false)
    }
  }, [setStatusMessage])

  const refreshData = useCallback(async () => {
    if (!activeContextId) return
    setLoading(true)
    try {
      await api.testDockerContext(activeContextId)
      setContexts((prev) =>
        prev.map((c) => (c.id === activeContextId ? { ...c, connected: true } : c))
      )
      if (view === 'compose') {
        setStatusMessage(t('common.ready'))
        return
      }
      if (view === 'images') {
        const list = await api.listImages(activeContextId)
        setImages(list)
        setImagePage((p) => clampPage(p, list.length, PAGE_SIZE))
        setStatusMessage(t('docker.loadedImages', { count: list.length }))
        return
      }
      const list = await api.listContainers(activeContextId)
      setContainers(list)
      setContainerPage((p) => clampPage(p, list.length, PAGE_SIZE))
      if (selectedId && list.some((c) => c.id === selectedId)) {
        await Promise.all([
          loadLogs(activeContextId, selectedId),
          loadContainerEnv(activeContextId, selectedId),
        ])
      } else {
        setSelectedId(list[0]?.id ?? null)
        if (list[0]) {
          await Promise.all([
            loadLogs(activeContextId, list[0].id),
            loadContainerEnv(activeContextId, list[0].id),
          ])
        } else {
          setLogs('')
          setContainerEnv([])
        }
      }
      setStatusMessage(t('docker.loadedContainers', { count: list.length }))
    } catch (e) {
      setContainers([])
      setImages([])
      setLogs('')
      setContainerEnv([])
      setContexts((prev) =>
        prev.map((c) => (c.id === activeContextId ? { ...c, connected: false } : c))
      )
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeContextId, view, selectedId, loadLogs, loadContainerEnv, setStatusMessage, t])

  useEffect(() => {
    if (workspaceLoaded.current) return
    workspaceLoaded.current = true
    void (async () => {
      const snap = await loadDockerWorkspace()
      if (snap?.activeContextId) setActiveContextId(snap.activeContextId)
      if (snap?.view) setView(snap.view)
      if (snap?.composeProjectDir) setComposeProjectDir(snap.composeProjectDir)
    })()
  }, [])

  useEffect(() => {
    scheduleDockerWorkspacePersist(toDockerWorkspaceSnapshot(activeContextId, view, composeProjectDir))
    void saveAppSetting(APP_SETTING_KEYS.lastDockerContextId, activeContextId)
  }, [activeContextId, view, composeProjectDir])

  useEffect(() => {
    void refreshContexts()
    void api.listSSHHosts().then(setSSHHosts).catch(() => setSSHHosts([]))
  }, [refreshContexts])

  useEffect(() => {
    if (!activeContextId) return
    void refreshData()
  }, [activeContextId, view])

  useEffect(() => {
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain === 'docker.context') {
        await refreshContexts()
        const id = evt.ids[0]
        if (evt.reveal && id && evt.op !== 'delete') {
          setActiveContextId(id)
        }
        if (evt.label) {
          useAppStore.getState().setStatusMessage(
            evt.op === 'delete' ? `Docker 上下文已删除：${evt.label}` : `Docker 上下文已更新：${evt.label}`,
          )
        }
        return
      }
      if (evt.domain !== 'docker.container') return
      const contextId = evt.ids[0]
      const containerId = evt.ids[1] || evt.ids[0]
      if (contextId && contextId !== activeContextId && evt.ids.length > 1) {
        setActiveContextId(contextId)
      }
      await refreshData()
      if (evt.reveal && containerId && evt.op !== 'delete') {
        setSelectedId(containerId)
        useAppStore.getState().setStatusMessage(
          evt.label ? `Docker 已更新：${evt.label}` : `容器已更新 ${containerId}`,
        )
      }
    }
    const pending = takePendingWorkbenchChanged('docker.')
    for (const evt of pending) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [activeContextId, refreshData, refreshContexts])

  useEffect(() => {
    setContainerPage(1)
    setImagePage(1)
  }, [activeContextId, view])

  useWorkbenchCommand(Capability.DockerContextOpen, (cmd) => {
    const hostId = payloadStr(cmd.payload, 'hostId')
    setContextModalHostId(hostId)
    setContextModalOpen(true)
    if (hostId) setStatusMessage(t('docker.addFromSsh'))
  })

  useEffect(() => {
    if (!ctxMenu && !contextCtxMenu) return
    const close = () => {
      setCtxMenu(null)
      setContextCtxMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [ctxMenu, contextCtxMenu])

  const selectContainer = async (container: DockerContainer) => {
    setSelectedId(container.id)
    setDetailTab('logs')
    await Promise.all([
      loadLogs(activeContextId, container.id),
      loadContainerEnv(activeContextId, container.id),
    ])
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
    runContainerAction(container, t('docker.starting', { name: container.name || container.shortId }), async () => {
      await api.startContainer(activeContextId, container.id)
    })

  const stopContainer = (container: DockerContainer) =>
    runContainerAction(container, t('docker.stopping', { name: container.name || container.shortId }), async () => {
      await api.stopContainer(activeContextId, container.id)
    })

  const restartContainer = (container: DockerContainer) =>
    runContainerAction(container, t('docker.restarting', { name: container.name || container.shortId }), async () => {
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
    setStatusMessage(t('docker.removing', { name }))
    try {
      await api.removeContainer(activeContextId, container.id)
      if (selectedId === container.id) {
        setSelectedId(null)
        setLogs('')
        setContainerEnv([])
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
    setStatusMessage(t('docker.preparingShell'))
    try {
      const host = await api.ensureDockerHost(activeContextId, container.id)
      openTerminal({ hostId: host.id }, 'docker')
      setStatusMessage(t('docker.openingShell', { name: container.name || container.shortId }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const openContainerFiles = async (container: DockerContainer) => {
    if (container.state !== 'running') return
    setStatusMessage(t('docker.preparingFiles'))
    try {
      const host = await api.ensureDockerHost(activeContextId, container.id)
      openSftp({ hostId: host.id }, 'docker')
      setStatusMessage(t('docker.openingFiles', { name: container.name || container.shortId }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const openDatabaseLink = async (container: DockerContainer) => {
    setStatusMessage(t('docker.resolvingDb'))
    try {
      const link = await api.resolveContainerDatabaseLink(activeContextId, container.id)
      openDatabase(
        {
          connectionDraft: {
            name: link.name,
            group: 'Docker',
            dbType: link.dbType,
            host: link.host,
            port: link.port,
            user: link.user,
            password: link.password,
            database: link.database,
            sshEnabled: link.sshEnabled,
            sshHostId: link.sshHostId,
          },
        },
        'docker',
      )
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** openRunModal 打开从镜像运行对话框。 */
  const openRunModal = (img: DockerImage) => {
    const tag = primaryImageTag(img.tags)
    if (!tag) {
      setStatusMessage(t('docker.noImageTag'))
      return
    }
    setRunModalImage(tag)
  }

  /** handleRunCreated 运行成功后切换到容器视图并选中。 */
  const handleRunCreated = async (container: DockerContainer) => {
    setRunModalImage(null)
    setView('containers')
    setLoading(true)
    try {
      const list = await api.listContainers(activeContextId)
      setContainers(list)
      const idx = list.findIndex((c) => c.id === container.id)
      const page = idx >= 0 ? clampPage(Math.floor(idx / PAGE_SIZE) + 1, list.length, PAGE_SIZE) : 1
      setContainerPage(page)
      setSelectedId(container.id)
      setDetailTab('env')
      await Promise.all([
        loadLogs(activeContextId, container.id),
        loadContainerEnv(activeContextId, container.id),
      ])
      setStatusMessage(t('docker.created', { name: container.name || container.shortId }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
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
      setContainerEnv([])
      setSelectedId(null)
      if (activeContextId === ctx.id) {
        setActiveContextId(LOCAL_CONTEXT)
      }
      await refreshContexts()
      setStatusMessage(t('docker.contextDeleted', { name: ctx.name }))
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
    if (!activeContext) return t('docker.notConnected')
    if (!dockerReady) return t('docker.dockerDown')
    if (view === 'images') return t('docker.imageCount', { count: images.length })
    if (selected) return t('docker.containerState', { name: selected.name || selected.shortId, state: selected.state })
    return t('docker.containerCount', { count: containers.length })
  }, [activeContext, dockerReady, view, selected, images.length, containers.length, t])

  const confirmDialogProps = useMemo(() => {
    if (!confirmState) return null
    if (confirmState.type === 'context') {
      return {
        title: t('docker.deleteContextTitle'),
        message: t('docker.deleteContextMsg', { name: confirmState.ctx.name }),
      }
    }
    const name = confirmState.container.name || confirmState.container.shortId
    return {
      title: t('docker.deleteContainerTitle'),
      message: t('docker.deleteContainerMsg', { name }),
    }
  }, [confirmState, t])

  const localContextLabel = t('docker.localContext')
  const stopRowClick = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div className="product-workbench docker-workbench">
      <div className="product-body">
        <aside className="app-sidebar docker-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('docker.sidebarTitle')}</span>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-sm"
                title={t('docker.addRemote')}
                {...pressProps(() => {
                  setContextModalHostId(undefined)
                  setContextModalOpen(true)
                })}
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
                    {...pressProps(() => setActiveContextId(ctx.id))}
                    onContextMenu={(e) => {
                      if (!canDeleteDockerContext(ctx)) return
                      e.preventDefault()
                      e.stopPropagation()
                      setContextCtxMenu({ x: e.clientX, y: e.clientY, context: ctx })
                    }}
                  >
                    <IconDocker size={14} className="mock-icon" />
                    <div className="conn-meta">
                      <span className="conn-name">{contextDisplayName(ctx, localContextLabel)}</span>
                      <span className="conn-host">{ctx.endpoint}</span>
                    </div>
                    {canDeleteDockerContext(ctx) && (
                      <button
                        type="button"
                        className="wn-btn wn-btn-text-danger docker-context-item-del"
                        title={t('docker.deleteContext')}
                        {...pressProps(() => requestDeleteDockerContext(ctx), { stop: true })}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </aside>

        <main className="app-main docker-main">
          <div className="editor-chrome">
            <div className="wn-tabs">
              <button
                type="button"
                className={`wn-tab wn-tab-docker ${view === 'containers' ? 'active' : ''}`}
                {...pressProps(() => setView('containers'))}
              >
                <span className="tab-dot" />
                <span className="tab-title">{t('docker.viewContainers')}</span>
              </button>
              <button
                type="button"
                className={`wn-tab wn-tab-docker ${view === 'images' ? 'active' : ''}`}
                {...pressProps(() => setView('images'))}
              >
                <span className="tab-dot" />
                <span className="tab-title">{t('docker.viewImages')}</span>
              </button>
              <button
                type="button"
                className={`wn-tab wn-tab-docker ${view === 'compose' ? 'active' : ''}`}
                {...pressProps(() => setView('compose'))}
              >
                <span className="tab-dot" />
                <span className="tab-title">{t('docker.compose')}</span>
              </button>
              <button type="button" className="wn-tab wn-tab-docker" disabled title={t('docker.swarmSoon')}>
                <span className="tab-dot" />
                <span className="tab-title">{t('docker.volumes')}</span>
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
              <span>{t('docker.cannotConnect')}</span>
              <span className="docker-empty-hint">
                {statusMessage && !READY_MESSAGES.has(statusMessage)
                  ? statusMessage
                  : isRemoteContext
                    ? t('docker.sshHint')
                    : t('docker.localHint')}
              </span>
              <button
                type="button"
                className="wn-btn wn-btn-tool wn-btn-sm"
                disabled={loading}
                {...pressProps(() => void refreshData(), { disabled: loading })}
              >
                {t('common.retry')}
              </button>
            </div>
          ) : view === 'compose' ? (
            <DockerComposePanel
              contextId={activeContextId}
              dockerReady={dockerReady}
              projectDir={composeProjectDir}
              onProjectDirChange={setComposeProjectDir}
              onStatus={setStatusMessage}
            />
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
                    <th>{t('docker.colTag')}</th>
                    <th>{t('docker.colId')}</th>
                    <th>{t('docker.colSize')}</th>
                    <th>{t('docker.colCreated')}</th>
                    <th className="docker-th-actions">{t('docker.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {images.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="grid-empty">
                        {loading ? t('common.loading') : t('docker.noImages')}
                      </td>
                    </tr>
                  ) : (
                    pagedImages.items.map((img) => (
                      <tr key={img.id} className="docker-row">
                        <td className="docker-col-image">
                          <DockerImageCell
                            image={img.tags}
                            onCopied={() => setStatusMessage(t('docker.copiedImageTag'))}
                          />
                        </td>
                        <td className="docker-mono">{img.shortId}</td>
                        <td>{formatImageSize(img.size)}</td>
                        <td>{img.createdAt ? new Date(img.createdAt * 1000).toLocaleString() : '-'}</td>
                        <td className="docker-col-actions">
                          <div className="docker-row-actions">
                            <button
                              type="button"
                              className="docker-act-btn accent"
                              disabled={acting || !dockerReady || primaryImageTag(img.tags) === ''}
                              {...pressProps(() => openRunModal(img), {
                                disabled: acting || !dockerReady || primaryImageTag(img.tags) === '',
                              })}
                            >
                              {t('common.run')}
                            </button>
                          </div>
                        </td>
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
                      <th>{t('docker.colName')}</th>
                      <th>{t('docker.colImage')}</th>
                      <th>{t('docker.colState')}</th>
                      <th>{t('docker.colPorts')}</th>
                      <th>{t('docker.colUptime')}</th>
                      <th className="docker-th-actions">{t('docker.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="grid-empty">
                          {loading ? t('common.loading') : t('docker.noContainers')}
                        </td>
                      </tr>
                    ) : (
                      pagedContainers.items.map((c) => {
                        const running = c.state === 'running'
                        return (
                          <tr
                            key={c.id}
                            className={`docker-row ${c.id === selectedId ? 'selected' : ''}`}
                            {...pressProps(() => void selectContainer(c))}
                            onContextMenu={(e) => openContainerContextMenu(e, c)}
                          >
                            <td className="docker-name docker-ellipsis" title={c.name || c.shortId}>
                              {c.name || c.shortId}
                            </td>
                            <td className="docker-col-image">
                              <DockerImageCell
                                image={c.image}
                                onCopied={() => setStatusMessage(t('docker.copiedImageName'))}
                              />
                            </td>
                            <td>
                              <span className={`docker-status docker-status-${c.state}`}>{c.state}</span>
                            </td>
                            <td className="docker-mono docker-ellipsis" title={c.ports}>
                              {c.ports}
                            </td>
                            <td className="docker-col-uptime">{formatUptime(c.state, c.createdAt)}</td>
                            <td className="docker-col-actions" onPointerDown={stopRowClick}>
                              <div className="docker-row-actions">
                                {!running && (
                                  <button
                                    type="button"
                                    className="docker-act-btn"
                                    disabled={!dockerReady || acting}
                                    title={t('docker.start')}
                                    {...pressProps(() => void startContainer(c), {
                                      disabled: !dockerReady || acting,
                                      stop: true,
                                    })}
                                  >
                                    {t('docker.start')}
                                  </button>
                                )}
                                {running && (
                                  <>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title={t('docker.stop')}
                                      {...pressProps(() => void stopContainer(c), {
                                        disabled: !dockerReady || acting,
                                        stop: true,
                                      })}
                                    >
                                      {t('docker.stop')}
                                    </button>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title={t('docker.restart')}
                                      {...pressProps(() => void restartContainer(c), {
                                        disabled: !dockerReady || acting,
                                        stop: true,
                                      })}
                                    >
                                      {t('docker.restart')}
                                    </button>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title={t('docker.shell')}
                                      {...pressProps(() => void openContainerShell(c), {
                                        disabled: !dockerReady || acting,
                                        stop: true,
                                      })}
                                    >
                                      {t('docker.shell')}
                                    </button>
                                    <button
                                      type="button"
                                      className="docker-act-btn"
                                      disabled={!dockerReady || acting}
                                      title={t('docker.files')}
                                      {...pressProps(() => void openContainerFiles(c), {
                                        disabled: !dockerReady || acting,
                                        stop: true,
                                      })}
                                    >
                                      {t('docker.files')}
                                    </button>
                                  </>
                                )}
                                {mayHaveDatabase(c) && (
                                  <button
                                    type="button"
                                    className="docker-act-btn accent"
                                    disabled={!dockerReady || acting}
                                    title={t('docker.openDatabase')}
                                    {...pressProps(() => void openDatabaseLink(c), {
                                      disabled: !dockerReady || acting,
                                      stop: true,
                                    })}
                                  >
                                    {t('docker.databaseShort')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="docker-act-btn danger"
                                  disabled={!dockerReady || acting}
                                  title={t('common.delete')}
                                  {...pressProps(() => void removeContainer(c), {
                                    disabled: !dockerReady || acting,
                                    stop: true,
                                  })}
                                >
                                  {t('common.delete')}
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
                  <div className="docker-detail-tabs">
                    <button
                      type="button"
                      className={`docker-detail-tab${detailTab === 'logs' ? ' is-active' : ''}`}
                      {...pressProps(() => setDetailTab('logs'))}
                    >
                      {t('docker.tabLogs')}
                    </button>
                    <button
                      type="button"
                      className={`docker-detail-tab${detailTab === 'env' ? ' is-active' : ''}`}
                      {...pressProps(() => setDetailTab('env'))}
                    >
                      {t('docker.tabEnv')}
                    </button>
                  </div>
                  <span className="docker-detail-title">{selected?.name || selected?.shortId || '—'}</span>
                  {selected && detailTab === 'logs' && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-tool wn-btn-sm"
                      disabled={acting}
                      {...pressProps(() => void loadLogs(activeContextId, selected.id), { disabled: acting })}
                    >
                      {t('common.refresh')}
                    </button>
                  )}
                  {selected && detailTab === 'env' && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-tool wn-btn-sm"
                      disabled={acting || envLoading}
                      {...pressProps(() => void loadContainerEnv(activeContextId, selected.id), {
                        disabled: acting || envLoading,
                      })}
                    >
                      {t('common.refresh')}
                    </button>
                  )}
                </header>
                {detailTab === 'logs' ? (
                  <pre className="docker-log-body">{logs || (loading ? t('common.loading') : t('docker.selectLogs'))}</pre>
                ) : (
                  <div className="docker-env-body">
                    {!selected ? (
                      <p className="docker-env-empty">{t('docker.selectEnv')}</p>
                    ) : envLoading ? (
                      <p className="docker-env-empty">{t('common.loading')}</p>
                    ) : containerEnv.length === 0 ? (
                      <p className="docker-env-empty">{t('docker.envEmpty')}</p>
                    ) : (
                      <table className="docker-env-table">
                        <thead>
                          <tr>
                            <th>{t('docker.envKey')}</th>
                            <th>{t('docker.envValue')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {containerEnv.map((item) => (
                            <tr key={item.key} className={item.highlight ? 'is-highlight' : ''}>
                              <td className="docker-env-key" title={item.key}>
                                {item.key}
                              </td>
                              <td className="docker-env-value" title={item.value}>
                                {item.value || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={confirmState != null}
        title={confirmDialogProps?.title ?? t('docker.confirmTitle')}
        message={confirmDialogProps?.message}
        confirmLabel={t('common.delete')}
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

      <DockerRunModal
        open={runModalImage != null}
        contextId={activeContextId}
        image={runModalImage ?? ''}
        onClose={() => setRunModalImage(null)}
        onCreated={(container) => void handleRunCreated(container)}
      />

      {contextCtxMenu && (
        <ContextMenu
          x={contextCtxMenu.x}
          y={contextCtxMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item danger"
            {...pressProps(() => requestDeleteDockerContext(contextCtxMenu.context))}
          >
            {t('docker.ctxMenuDeleteContext')}
          </button>
        </ContextMenu>
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const c = ctxMenu.container
              const hostId = activeContext?.sshHostId ?? ''
              const ssh = hostId ? sshHosts.find((h) => h.id === hostId) : undefined
              const mentions = hostId
                ? [
                    mentionSSH({
                      id: hostId,
                      name: ssh?.name ?? activeContext?.name,
                      host: ssh?.host ?? activeContext?.name ?? hostId,
                    }),
                  ]
                : []
              setCtxMenu(null)
              openAgentDraft({
                mentions,
                message: `${t('agent.draftDocker')}\n\n容器: ${c.name}\n镜像: ${c.image}\n状态: ${c.status}`,
              })
            })}
          >
            {t('agent.sendToAgent')}
          </button>
          {mayHaveDatabase(ctxMenu.container) && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                setCtxMenu(null)
                void openDatabaseLink(ctxMenu.container)
              })}
            >
              {t('docker.openDatabase')}
            </button>
          )}
          {ctxMenu.container.state === 'running' && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtxMenu(null)
                  void openContainerShell(ctxMenu.container)
                })}
              >
                {t('docker.ctxMenuOpenShell')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtxMenu(null)
                  void openContainerFiles(ctxMenu.container)
                })}
              >
                {t('docker.ctxMenuOpenFiles')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setCtxMenu(null)
                  const c = ctxMenu.container
                  openLogs(
                    {
                      sourceType: 'docker',
                      name: c.name || c.shortId,
                      dockerContextId: activeContextId,
                      containerId: c.id,
                      fetch: true,
                    },
                    'docker',
                  )
                })}
              >
                {t('docker.ctxMenuOpenLogs')}
              </button>
            </>
          )}
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              const c = ctxMenu.container
              const hostId = activeContext?.sshHostId ?? ''
              openNotebook(
                {
                  hostId: hostId || undefined,
                  initialCommand: `# ${c.name}\n# ${c.image}\n# ${c.status}\n\n\`\`\`shell\ndocker logs -f ${c.name}\ndocker exec -it ${c.name} sh\n\`\`\`\n`,
                },
                'docker',
              )
              setStatusMessage(t('docker.creatingNote'))
            })}
          >
            {t('docker.ctxMenuNotebook')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              void navigator.clipboard.writeText(ctxMenu.container.image)
              setStatusMessage(t('docker.copiedImageName'))
              setCtxMenu(null)
            })}
          >
            {t('docker.ctxMenuCopyImage')}
          </button>
        </ContextMenu>
      )}
    </div>
  )
}

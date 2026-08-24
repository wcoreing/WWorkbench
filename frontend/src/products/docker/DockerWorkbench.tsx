import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { ContainerEnvVar, DockerContainer, DockerContext, DockerImage, SSHHost } from '../../api/types'
import { IconDocker, IconPlus } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { ProductLayout, ResizeHandle, useResizable } from '../../components/layout'
import { DockerContextModal } from '../../features/docker/DockerContextModal'
import { DockerComposePanel } from '../../features/docker/DockerComposePanel'
import {
  canDeleteDockerContext,
  contextDisplayName,
  contextEndpointLabel,
  DEFAULT_LOCAL_DOCKER_CONTEXT,
  LOCAL_DOCKER_CONTEXT,
  upsertDockerContext,
} from '../../features/docker/dockerContextDisplay'
import { clampPage, DOCKER_PAGE_SIZE, DockerListBar, mayHaveDatabase, paginateList } from '../../features/docker/dockerListUtils'
import { DockerRunModal } from '../../features/docker/DockerRunModal'
import { DockerContainerEditModal } from '../../features/docker/DockerContainerEditModal'
import { useDockerContainerShell, type DockerDetailTab } from '../../features/docker/useDockerContainerShell'
import { TerminalPane, terminalBackground } from '../../features/terminal/TerminalPane'
import { READY_MESSAGES, useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildDockerSurface } from '../../stores/agentSurface'
import { openAgentDraft, mentionSSH } from '../../features/agent/openAgentDraft'
import { openSftp, openDatabase, openNotebook, openLogs, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { APP_SETTING_KEYS, saveAppSetting } from '../../stores/appPreferences'
import { pressProps, useDismissOverlays } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'
import { useLoading, withLoading } from '../../stores/loadingStore'

const DOCKER_LOADING_MAIN = 'docker.main'
import {
  loadDockerWorkspace,
  scheduleDockerWorkspacePersist,
  toDockerWorkspaceSnapshot,
  type DockerView,
} from '../../stores/dockerWorkspacePersist'

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

/** formatPortLine 单条端口：优先 主机:容器，无主机则 容器/协议。 */
function formatPortLine(hostPort: number, containerPort: number, protocol: string): string {
  const proto = protocol || 'tcp'
  if (hostPort > 0) return `${hostPort}:${containerPort}`
  return `${containerPort}/${proto}`
}

/** formatMountLine 单条挂载：只强调容器路径。 */
function formatMountLine(destination: string, type: string, rw: boolean): string {
  const dest = destination || '-'
  const kind = type === 'volume' ? 'vol' : type === 'bind' ? 'bind' : type || 'mnt'
  return `${kind}:${dest}${rw === false ? ':ro' : ''}`
}

/** sortPortMappings 公开映射排前，便于列表摘要。 */
function sortPortMappings(container: DockerContainer) {
  const list = [...(container.portMappings ?? [])]
  list.sort((a, b) => Number(b.hostPort > 0) - Number(a.hostPort > 0) || a.containerPort - b.containerPort)
  return list
}

/** portCellTitle 悬停展示全部端口。 */
function portCellTitle(container: DockerContainer): string {
  const mappings = sortPortMappings(container)
  if (mappings.length > 0) {
    return mappings.map((p) => formatPortLine(p.hostPort, p.containerPort, p.protocol)).join('\n')
  }
  return container.ports || '-'
}

/** mountCellTitle 悬停展示全部挂载。 */
function mountCellTitle(container: DockerContainer): string {
  const mounts = container.mounts ?? []
  if (mounts.length === 0) return '-'
  return mounts
    .map((m) => {
      const src = m.name || m.source || '-'
      return `${src} → ${m.destination || '-'}${m.rw === false ? ' (ro)' : ''}`
    })
    .join('\n')
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
        {formatImageShort(image, 40)}
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

interface DockerSummaryCellProps {
  title: string
  primary: string
  extra: number
  empty: string
  onEdit: () => void
}

/** DockerSummaryCell 单行摘要：主值 + 其余条数，点击编辑。 */
function DockerSummaryCell({ title, primary, extra, empty, onEdit }: DockerSummaryCellProps) {
  const { t } = useI18n()
  const has = primary !== ''
  return (
    <button type="button" className="docker-summary-cell" title={title} {...pressProps(onEdit, { stop: true })}>
      {has ? (
        <>
          <span className="docker-summary-primary">{primary}</span>
          {extra > 0 && <span className="docker-summary-extra">{t('docker.summaryExtra', { count: extra })}</span>}
        </>
      ) : (
        <span className="docker-summary-empty">{empty}</span>
      )}
    </button>
  )
}

interface DockerPortCellProps {
  container: DockerContainer
  onEdit: () => void
}

/** DockerPortCell 端口单行摘要。 */
function DockerPortCell({ container, onEdit }: DockerPortCellProps) {
  const mappings = sortPortMappings(container)
  const primary = mappings[0]
  return (
    <DockerSummaryCell
      title={portCellTitle(container)}
      primary={primary ? formatPortLine(primary.hostPort, primary.containerPort, primary.protocol) : ''}
      extra={Math.max(0, mappings.length - 1)}
      empty={container.ports && container.ports !== '-' ? container.ports : '-'}
      onEdit={onEdit}
    />
  )
}

interface DockerMountCellProps {
  container: DockerContainer
  onEdit: () => void
}

/** DockerMountCell 挂载单行摘要。 */
function DockerMountCell({ container, onEdit }: DockerMountCellProps) {
  const mounts = container.mounts ?? []
  const primary = mounts[0]
  return (
    <DockerSummaryCell
      title={mountCellTitle(container)}
      primary={primary ? formatMountLine(primary.destination, primary.type, primary.rw) : ''}
      extra={Math.max(0, mounts.length - 1)}
      empty="-"
      onEdit={onEdit}
    />
  )
}

/** DockerWorkbench Docker 容器与镜像管理工作区。 */
export function DockerWorkbench() {
  const { setStatusMessage, statusMessage, setAgentSurface, activeProduct, terminalOpacity } = useAppStore()
  const { t } = useI18n()
  const [contexts, setContexts] = useState<DockerContext[]>([DEFAULT_LOCAL_DOCKER_CONTEXT])
  const [activeContextId, setActiveContextId] = useState(LOCAL_DOCKER_CONTEXT)
  const [view, setView] = useState<DockerView>('containers')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [containerEnv, setContainerEnv] = useState<ContainerEnvVar[]>([])
  const [detailTab, setDetailTab] = useState<DockerDetailTab>('logs')
  const mainLoading = useLoading(DOCKER_LOADING_MAIN)
  const [acting, setActing] = useState(false)
  const [sshHosts, setSSHHosts] = useState<SSHHost[]>([])
  const [contextModalOpen, setContextModalOpen] = useState(false)
  const [contextModalHostId, setContextModalHostId] = useState<string | undefined>()
  const [runModalImage, setRunModalImage] = useState<string | null>(null)
  const [editContainer, setEditContainer] = useState<DockerContainer | null>(null)
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
  const { size: logPanelHeight, onResizeStart: onLogPanelResizeStart } = useResizable({
    axis: 'y',
    storageKey: 'docker_log_panel_height',
    defaultSize: 220,
    min: 120,
    max: 560,
    invert: true,
  })

  const activeContext = contexts.find((c) => c.id === activeContextId)
  const selected = containers.find((c) => c.id === selectedId) ?? null
  const envLoadingKey = selected ? `docker.env.${selected.id}` : 'docker.env._'
  const envPaneLoading = useLoading(envLoadingKey)
  const dockerReady =
    Boolean(activeContext?.connected) || (!mainLoading.active && (containers.length > 0 || images.length > 0))
  const isRemoteContext = activeContext != null && activeContext.id !== LOCAL_DOCKER_CONTEXT
  const shellActionLabel = isRemoteContext ? t('docker.shellRemote') : t('docker.shell')

  const {
    shellSessionId,
    shellLoadingKey,
    shellError,
    openContainerShell,
    popOutContainerShell,
  } = useDockerContainerShell({
    activeContextId,
    detailTab,
    setDetailTab,
    setStatusMessage,
    t,
  })
  const shellPaneLoading = useLoading(shellLoadingKey)

  useEffect(() => {
    if (activeProduct !== 'docker') return
    const sshHostId = activeContext?.sshHostId?.trim() || ''
    const sshHost = sshHostId ? sshHosts.find((h) => h.id === sshHostId) : undefined
    setAgentSurface(
      buildDockerSurface({
        contextId: activeContextId,
        contextLabel: activeContext ? contextDisplayName(activeContext, t('docker.localContext')) : activeContextId,
        sshHostId,
        sshHostLabel: sshHost?.name?.trim() || sshHost?.host || sshHostId,
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
    sshHosts,
    view,
    selected,
    composeProjectDir,
    images.length,
    containers.length,
    setAgentSurface,
    t,
  ])

  const pagedContainers = useMemo(
    () => paginateList(containers, containerPage, DOCKER_PAGE_SIZE),
    [containers, containerPage]
  )
  const pagedImages = useMemo(() => paginateList(images, imagePage, DOCKER_PAGE_SIZE), [images, imagePage])

  const refreshContexts = useCallback(async () => {
    try {
      const list = await api.listDockerContexts()
      setContexts(list)
      setActiveContextId((current) => (list.some((c) => c.id === current) ? current : LOCAL_DOCKER_CONTEXT))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage])

  /** loadSSHHosts 拉取 SSH 主机，用于远程上下文展示与 Agent 提及。 */
  const loadSSHHosts = useCallback(async () => {
    try {
      const list = await api.listSSHHosts()
      setSSHHosts(list)
    } catch (e) {
      setSSHHosts([])
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
    const key = `docker.env.${containerId}`
    try {
      await withLoading(
        key,
        async () => {
          const env = await api.getContainerEnv(contextId, containerId)
          setContainerEnv(env?.vars ?? [])
        },
        {
          label: t('common.loading'),
          onBegin: () => setContainerEnv([]),
        },
      )
    } catch (e) {
      setContainerEnv([])
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage, t])

  const refreshData = useCallback(async () => {
    if (!activeContextId) return
    try {
      await withLoading(
        DOCKER_LOADING_MAIN,
        async () => {
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
            setImagePage((p) => clampPage(p, list.length, DOCKER_PAGE_SIZE))
            setStatusMessage(t('docker.loadedImages', { count: list.length }))
            return
          }
          const list = await api.listContainers(activeContextId)
          setContainers(list)
          setContainerPage((p) => clampPage(p, list.length, DOCKER_PAGE_SIZE))
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
        },
        {
          label: t('common.loading'),
          onBegin: () => {
            if (view === 'images') {
              setImages([])
              return
            }
            if (view !== 'compose') {
              setContainers([])
              setLogs('')
              setContainerEnv([])
            }
          },
        },
      )
    } catch (e) {
      setContainers([])
      setImages([])
      setLogs('')
      setContainerEnv([])
      setContexts((prev) =>
        prev.map((c) => (c.id === activeContextId ? { ...c, connected: false } : c))
      )
      setStatusMessage((e as Error).message)
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
    void loadSSHHosts()
  }, [refreshContexts, loadSSHHosts])

  useEffect(() => {
    if (activeProduct === 'docker') void loadSSHHosts()
  }, [activeProduct, loadSSHHosts])

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
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain !== 'ssh.host') return
      await loadSSHHosts()
    }
    for (const evt of takePendingWorkbenchChanged('ssh.host')) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [loadSSHHosts])

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
    try {
      await withLoading(
        DOCKER_LOADING_MAIN,
        async () => {
          const list = await api.listContainers(activeContextId)
          setContainers(list)
          const idx = list.findIndex((c) => c.id === container.id)
          const page = idx >= 0 ? clampPage(Math.floor(idx / DOCKER_PAGE_SIZE) + 1, list.length, DOCKER_PAGE_SIZE) : 1
          setContainerPage(page)
          setSelectedId(container.id)
          setDetailTab('env')
          await Promise.all([
            loadLogs(activeContextId, container.id),
            loadContainerEnv(activeContextId, container.id),
          ])
          setStatusMessage(t('docker.created', { name: container.name || container.shortId }))
        },
        {
          label: t('common.loading'),
          onBegin: () => {
            setContainers([])
            setLogs('')
            setContainerEnv([])
          },
        },
      )
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
      setContainerEnv([])
      setSelectedId(null)
      if (activeContextId === ctx.id) {
        setActiveContextId(LOCAL_DOCKER_CONTEXT)
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
      <ProductLayout
        storageKey="docker_sidebar_width"
        resizeTitle={t('common.resizeWidth')}
        sidebarClassName="docker-sidebar"
        sidebar={
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
                  void loadSSHHosts()
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
                      <span className="conn-host">{contextEndpointLabel(ctx, sshHosts)}</span>
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
        }
      >
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

          {!dockerReady && !mainLoading.active ? (
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
                disabled={mainLoading.active}
                {...pressProps(() => void refreshData(), { disabled: mainLoading.active })}
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
                pageSize={DOCKER_PAGE_SIZE}
                loading={mainLoading.active}
                acting={acting}
                onPageChange={setImagePage}
                onRefresh={() => void refreshData()}
              />
              <LoadingPane loadingKey={DOCKER_LOADING_MAIN} label={t('common.loading')} minHeight={240}>
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
                        {t('docker.noImages')}
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
              </LoadingPane>
            </div>
          ) : (
            <div className="docker-layout">
              <div className="docker-list-panel docker-list-panel-containers">
                <DockerListBar
                  page={pagedContainers.page}
                  total={containers.length}
                  pageSize={DOCKER_PAGE_SIZE}
                  loading={mainLoading.active}
                  acting={acting}
                  onPageChange={setContainerPage}
                  onRefresh={() => void refreshData()}
                />
                {selected && dockerReady && (
                  <div className="docker-selection-bar">
                    <span className="docker-selection-label" title={selected.name || selected.shortId}>
                      {selected.name || selected.shortId}
                    </span>
                    <div className="docker-selection-actions">
                      {selected.state === 'running' && (
                        <>
                          <button
                            type="button"
                            className="wn-btn wn-btn-sm wn-btn-primary"
                            disabled={acting}
                            {...pressProps(() => void openContainerShell(selected), { disabled: acting })}
                          >
                            {shellActionLabel}
                          </button>
                          <button
                            type="button"
                            className="wn-btn wn-btn-sm wn-btn-tool"
                            disabled={acting}
                            {...pressProps(() => void openContainerFiles(selected), { disabled: acting })}
                          >
                            {t('docker.files')}
                          </button>
                        </>
                      )}
                      {selected.state !== 'running' && (
                        <button
                          type="button"
                          className="wn-btn wn-btn-sm wn-btn-tool"
                          disabled={acting}
                          {...pressProps(() => void startContainer(selected), { disabled: acting })}
                        >
                          {t('docker.start')}
                        </button>
                      )}
                      {mayHaveDatabase(selected) && (
                        <button
                          type="button"
                          className="wn-btn wn-btn-sm wn-btn-tool"
                          disabled={acting}
                          {...pressProps(() => void openDatabaseLink(selected), { disabled: acting })}
                        >
                          {t('docker.databaseShort')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <LoadingPane loadingKey={DOCKER_LOADING_MAIN} label={t('common.loading')} minHeight={240}>
                <div className="docker-table-wrap">
                <table className="docker-table docker-table-containers">
                  <colgroup>
                    <col className="docker-col-name" />
                    <col className="docker-col-image" />
                    <col className="docker-col-state" />
                    <col className="docker-col-ports" />
                    <col className="docker-col-mounts" />
                    <col className="docker-col-uptime" />
                    <col className="docker-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>{t('docker.colName')}</th>
                      <th>{t('docker.colImage')}</th>
                      <th>{t('docker.colState')}</th>
                      <th>{t('docker.colPorts')}</th>
                      <th>{t('docker.colMounts')}</th>
                      <th>{t('docker.colUptime')}</th>
                      <th className="docker-th-actions">{t('docker.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="grid-empty">
                          {t('docker.noContainers')}
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
                            <td className="docker-col-port-maps">
                              <DockerPortCell container={c} onEdit={() => setEditContainer(c)} />
                            </td>
                            <td className="docker-col-mount-maps">
                              <DockerMountCell container={c} onEdit={() => setEditContainer(c)} />
                            </td>
                            <td className="docker-col-uptime">{formatUptime(c.state, c.createdAt)}</td>
                            <td className="docker-col-actions" onPointerDown={stopRowClick}>
                              <div className="docker-row-actions">
                                <button
                                  type="button"
                                  className="docker-act-btn"
                                  disabled={!dockerReady || acting}
                                  title={t('docker.editModal.title')}
                                  {...pressProps(() => setEditContainer(c), {
                                    disabled: !dockerReady || acting,
                                    stop: true,
                                  })}
                                >
                                  {t('common.edit')}
                                </button>
                                {!running ? (
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
                                ) : (
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
                                )}
                                {running && (
                                  <button
                                    type="button"
                                    className="docker-act-btn"
                                    disabled={!dockerReady || acting}
                                    title={shellActionLabel}
                                    {...pressProps(() => void openContainerShell(c), {
                                      disabled: !dockerReady || acting,
                                      stop: true,
                                    })}
                                  >
                                    {t('docker.shell')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="docker-act-btn docker-act-more"
                                  disabled={!dockerReady || acting}
                                  title={t('docker.moreActions')}
                                  {...pressProps(
                                    (e) => {
                                      const el = e.currentTarget as HTMLElement
                                      const rect = el.getBoundingClientRect()
                                      setCtxMenu({
                                        x: Math.round(rect.right - 8),
                                        y: Math.round(rect.bottom + 4),
                                        container: c,
                                      })
                                    },
                                    { disabled: !dockerReady || acting, stop: true },
                                  )}
                                >
                                  ···
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
                </LoadingPane>
              </div>
              <ResizeHandle
                axis="y"
                onMouseDown={onLogPanelResizeStart}
                title={t('common.resizeHeight')}
              />
              <div className="docker-log-panel" style={{ height: logPanelHeight }}>
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
                      className={`docker-detail-tab${detailTab === 'shell' ? ' is-active' : ''}`}
                      disabled={!selected || selected.state !== 'running'}
                      {...pressProps(() => {
                        if (!selected || selected.state !== 'running') return
                        setDetailTab('shell')
                        void openContainerShell(selected, { showTab: false })
                      }, { disabled: !selected || selected.state !== 'running' })}
                    >
                      {t('docker.tabShell')}
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
                  {selected && detailTab === 'shell' && selected.state === 'running' && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-tool wn-btn-sm"
                      disabled={acting || shellPaneLoading.active}
                      {...pressProps(() => void popOutContainerShell(selected), { disabled: acting || shellPaneLoading.active })}
                    >
                      {t('docker.popOutShell')}
                    </button>
                  )}
                  {selected && detailTab === 'env' && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-tool wn-btn-sm"
                      disabled={acting || envPaneLoading.active}
                      {...pressProps(() => void loadContainerEnv(activeContextId, selected.id), {
                        disabled: acting || envPaneLoading.active,
                      })}
                    >
                      {t('common.refresh')}
                    </button>
                  )}
                </header>
                {detailTab === 'logs' ? (
                  <pre className="docker-log-body">{logs || (mainLoading.active ? t('common.loading') : t('docker.selectLogs'))}</pre>
                ) : detailTab === 'shell' ? (
                  <div
                    className="docker-shell-body"
                    style={{ backgroundColor: terminalBackground(terminalOpacity) }}
                  >
                    <LoadingPane loadingKey={shellLoadingKey} label={t('docker.preparingShell')} minHeight={120}>
                      {!selected ? (
                        <p className="docker-env-empty">{t('docker.selectShell')}</p>
                      ) : selected.state !== 'running' ? (
                        <p className="docker-env-empty">{t('docker.shellNeedsRunning')}</p>
                      ) : shellError ? (
                        <p className="docker-env-empty">{shellError}</p>
                      ) : shellSessionId ? (
                        <div className="docker-shell-pane">
                          <TerminalPane
                            sessionId={shellSessionId}
                            active={activeProduct === 'docker' && detailTab === 'shell'}
                            focused
                            opacity={terminalOpacity}
                          />
                        </div>
                      ) : (
                        <p className="docker-env-empty">{t('docker.selectShell')}</p>
                      )}
                    </LoadingPane>
                  </div>
                ) : (
                  <div className="docker-env-body">
                    <LoadingPane loadingKey={envLoadingKey} label={t('common.loading')} minHeight={120}>
                      {!selected ? (
                        <p className="docker-env-empty">{t('docker.selectEnv')}</p>
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
                    </LoadingPane>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </ProductLayout>

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
        initialHostId={contextModalHostId}
        onClose={() => {
          setContextModalOpen(false)
          setContextModalHostId(undefined)
        }}
        onSaved={(ctx) => {
          setContexts((prev) => upsertDockerContext(prev, ctx))
          setActiveContextId(ctx.id)
          setStatusMessage(t('docker.contextSaved', { name: ctx.name }))
          void refreshContexts()
          void loadSSHHosts()
        }}
      />

      <DockerRunModal
        open={runModalImage != null}
        contextId={activeContextId}
        image={runModalImage ?? ''}
        onClose={() => setRunModalImage(null)}
        onCreated={(container) => void handleRunCreated(container)}
      />

      <DockerContainerEditModal
        open={editContainer != null}
        contextId={activeContextId}
        container={editContainer}
        onClose={() => setEditContainer(null)}
        onUpdated={(container) => {
          setSelectedId(container.id)
          setStatusMessage(t('docker.updated', { name: container.name || container.shortId }))
          void refreshData()
        }}
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
              setCtxMenu(null)
              setEditContainer(ctxMenu.container)
            })}
          >
            {t('docker.editModal.title')}
          </button>
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
                  void restartContainer(ctxMenu.container)
                })}
              >
                {t('docker.restart')}
              </button>
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
          <button
            type="button"
            className="wn-context-item danger"
            {...pressProps(() => {
              setCtxMenu(null)
              void removeContainer(ctxMenu.container)
            })}
          >
            {t('common.delete')}
          </button>
        </ContextMenu>
      )}
    </div>
  )
}

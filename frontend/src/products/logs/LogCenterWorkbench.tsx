import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DockerContainer, DockerContext, LogSource, LogSourceType, SSHHost } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import { IconPlus, IconRefresh } from '../../components/Icons'
import { openAgentDraft, mentionLogSource } from '../../features/agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildLogsSurface, briefList } from '../../stores/agentSurface'
import { useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadBool, payloadStr } from '../../workbench/commandPayload'
import { subscribeLogsChunks } from '../../api/logsEvents'
import { loadLogsWorkspace, scheduleLogsWorkspacePersist } from '../../stores/logsWorkspacePersist'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { model } from '../../../wailsjs/go/models'
import { Select, pressProps, useDismissOverlays } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'
import { useLoading, withLoading } from '../../stores/loadingStore'

const LOGS_LOADING_CONTENT = 'logs.content'

const SOURCE_TYPES: LogSourceType[] = ['local_file', 'ssh_file', 'docker', 'compose']

const TYPE_LABEL_KEYS: Record<LogSourceType, string> = {
  local_file: 'logs.typeLocal',
  ssh_file: 'logs.typeSSH',
  docker: 'logs.typeDocker',
  compose: 'logs.typeCompose',
}

function logLineTone(line: string): 'error' | 'warning' | 'debug' | 'info' | '' {
  if (/\b(fatal|panic|error|exception|failed|failure)\b/i.test(line)) return 'error'
  if (/\b(warn|warning|deprecated)\b/i.test(line)) return 'warning'
  if (/\b(debug|trace)\b/i.test(line)) return 'debug'
  if (/\b(info|notice|success|started|ready)\b/i.test(line)) return 'info'
  return ''
}

function splitContentLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\n$/, '').split('\n')
}

function countContentLines(text: string): number {
  return splitContentLines(text).length
}

/** canFetchLogConfig 判断当前表单是否满足拉取日志条件。 */
function canFetchLogConfig(
  sourceType: LogSourceType,
  path: string,
  sshHostId: string,
  dockerContextId: string,
  containerId: string,
  composeDir: string,
): boolean {
  switch (sourceType) {
    case 'local_file':
      return path.trim() !== ''
    case 'ssh_file':
      return sshHostId !== '' && path.trim() !== ''
    case 'docker':
      return dockerContextId !== '' && containerId !== ''
    case 'compose':
      return dockerContextId !== '' && composeDir.trim() !== ''
    default:
      return false
  }
}

function sourceToDO(item: LogSource, tail: number): model.LogSourceDO {
  return model.LogSourceDO.createFrom({
    id: item.id,
    name: item.name,
    sourceType: item.sourceType,
    path: item.path,
    sshHostId: item.sshHostId,
    dockerContextId: item.dockerContextId,
    containerId: item.containerId,
    composeDir: item.composeDir,
    composeService: item.composeService,
    tailLines: tail,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  })
}

/** LogCenterWorkbench 日志中心工作区。 */
export function LogCenterWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const [items, setItems] = useState<LogSource[]>([])
  const [activeId, setActiveId] = useState('')
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState<LogSourceType>('local_file')
  const [path, setPath] = useState('')
  const [sshHostId, setSSHHostId] = useState('')
  const [dockerContextId, setDockerContextId] = useState('')
  const [containerId, setContainerId] = useState('')
  const [composeDir, setComposeDir] = useState('')
  const [composeService, setComposeService] = useState('')
  const [tailLines, setTailLines] = useState(200)
  const [content, setContent] = useState('')
  const contentLoading = useLoading(LOGS_LOADING_CONTENT)
  const [followLive, setFollowLive] = useState(false)
  const followStreamId = useRef('')
  const [deleteTarget, setDeleteTarget] = useState<LogSource | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: LogSource } | null>(null)
  useDismissOverlays(() => setCtxMenu(null))
  const [sshHosts, setSSHHosts] = useState<SSHHost[]>([])
  const [dockerContexts, setDockerContexts] = useState<DockerContext[]>([])
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const workspaceLoaded = useRef(false)
  const preRef = useRef<HTMLPreElement>(null)
  const stickToBottomRef = useRef(true)
  /** 已加载内容中最旧一行距日志末尾的行距（打开/刷新后 = 当前行数）。 */
  const oldestSkipRef = useRef(0)
  const hasMoreOlderRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const activeItem = useMemo(
    () => items.find((i) => i.id === activeId) ?? null,
    [items, activeId],
  )

  useEffect(() => {
    if (activeProduct !== 'logs') return
    setAgentSurface(
      buildLogsSurface({
        sourceId: activeId || undefined,
        name: name || activeItem?.name,
        sourceType,
        path,
        containerId,
        followLive,
        openTabsBrief: briefList(
          items.map((i) => i.name),
          12,
        ),
      }),
    )
  }, [activeProduct, activeId, name, activeItem, sourceType, path, containerId, followLive, items, setAgentSurface])

  const sendToAgent = useCallback(
    (item: LogSource) => {
      openAgentDraft({
        mentions: [mentionLogSource(item)],
        message: t('agent.draftLogs'),
      })
    },
    [t],
  )

  const resetHistoryCursor = useCallback((text: string) => {
    const n = countContentLines(text)
    oldestSkipRef.current = n
    hasMoreOlderRef.current = n > 0
    setHasMoreOlder(n > 0)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = preRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const loadEditor = useCallback((item: LogSource | null) => {
    if (!item) {
      setName('')
      setSourceType('local_file')
      setPath('')
      setSSHHostId('')
      setDockerContextId('')
      setContainerId('')
      setComposeDir('')
      setComposeService('')
      setTailLines(200)
      return
    }
    setName(item.name)
    setSourceType(item.sourceType)
    setPath(item.path)
    setSSHHostId(item.sshHostId)
    setDockerContextId(item.dockerContextId)
    setContainerId(item.containerId)
    setComposeDir(item.composeDir)
    setComposeService(item.composeService)
    setTailLines(item.tailLines > 0 ? item.tailLines : 200)
  }, [])

  const refreshList = useCallback(async () => {
    const list = (await api.listLogSources()) as LogSource[]
    setItems(list)
    return list
  }, [])

  useEffect(() => {
    void api.listSSHHosts().then((h) => setSSHHosts(h as SSHHost[])).catch(console.error)
    void api.listDockerContexts().then((c) => setDockerContexts(c as DockerContext[])).catch(console.error)
  }, [])

  useEffect(() => {
    if (sourceType !== 'docker' || !dockerContextId) {
      setContainers([])
      return
    }
    void api.listContainers(dockerContextId).then((c) => setContainers(c as DockerContainer[])).catch(() => setContainers([]))
  }, [sourceType, dockerContextId])

  const buildSourceConfig = useCallback(
    () =>
      model.LogSourceDO.createFrom({
        id: activeId,
        name: name.trim(),
        sourceType,
        path: path.trim(),
        sshHostId,
        dockerContextId,
        containerId,
        composeDir: composeDir.trim(),
        composeService: composeService.trim(),
        tailLines,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    [
      activeId,
      name,
      sourceType,
      path,
      sshHostId,
      dockerContextId,
      containerId,
      composeDir,
      composeService,
      tailLines,
    ],
  )

  const fetchReady = useMemo(
    () => canFetchLogConfig(sourceType, path, sshHostId, dockerContextId, containerId, composeDir),
    [sourceType, path, sshHostId, dockerContextId, containerId, composeDir],
  )

  const applyTailContent = useCallback(
    (text: string) => {
      setContent(text)
      resetHistoryCursor(text)
      stickToBottomRef.current = true
      requestAnimationFrame(scrollToBottom)
    },
    [resetHistoryCursor, scrollToBottom],
  )

  const fetchTailConfig = useCallback(
    async (cfg: model.LogSourceDO, lines: number) => {
      if (!canFetchLogConfig(
        cfg.sourceType as LogSourceType,
        cfg.path,
        cfg.sshHostId,
        cfg.dockerContextId,
        cfg.containerId,
        cfg.composeDir,
      )) {
        setStatusMessage(t('logs.errConfig'))
        return
      }
      setStatusMessage(t('logs.refreshing'))
      try {
        await withLoading(
          LOGS_LOADING_CONTENT,
          async () => {
            const res = await api.fetchLogSourceConfig(cfg, lines, 0)
            applyTailContent(res.content || '')
            setStatusMessage(t('logs.refresh'))
          },
          {
            label: t('logs.refreshing'),
            onBegin: () => setContent(''),
          },
        )
      } catch (e) {
        setContent((e as Error).message)
        resetHistoryCursor('')
        setStatusMessage((e as Error).message)
      }
    },
    [applyTailContent, resetHistoryCursor, setStatusMessage, t],
  )

  const refreshLogs = useCallback(async () => {
    await fetchTailConfig(buildSourceConfig(), tailLines)
  }, [buildSourceConfig, fetchTailConfig, tailLines])

  const loadOlder = useCallback(async () => {
    if (!fetchReady || loadingOlderRef.current || !hasMoreOlderRef.current || contentLoading.active) return
    if (oldestSkipRef.current <= 0) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    const pre = preRef.current
    const prevHeight = pre?.scrollHeight ?? 0
    const prevTop = pre?.scrollTop ?? 0
    try {
      const res = await api.fetchLogSourceConfig(buildSourceConfig(), tailLines, oldestSkipRef.current)
      const olderText = res.content || ''
      const olderLines = splitContentLines(olderText)
      if (olderLines.length === 0) {
        hasMoreOlderRef.current = false
        setHasMoreOlder(false)
        return
      }
      if (olderLines.length < tailLines) {
        hasMoreOlderRef.current = false
        setHasMoreOlder(false)
      }
      oldestSkipRef.current += olderLines.length
      setContent((prev) => {
        if (!prev) return olderText
        return `${olderText}\n${prev}`
      })
      requestAnimationFrame(() => {
        if (!pre) return
        pre.scrollTop = pre.scrollHeight - prevHeight + prevTop
      })
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [buildSourceConfig, contentLoading.active, fetchReady, setStatusMessage, tailLines])

  useEffect(() => {
    if (workspaceLoaded.current) {
      void refreshList()
      return
    }
    workspaceLoaded.current = true
    void (async () => {
      const list = await refreshList()
      const snap = await loadLogsWorkspace()
      const id = snap?.activeId && list.some((x) => x.id === snap.activeId) ? snap.activeId : list[0]?.id ?? ''
      setActiveId(id)
      const item = list.find((x) => x.id === id) ?? null
      loadEditor(item)
      if (item && canFetchLogConfig(
        item.sourceType,
        item.path,
        item.sshHostId,
        item.dockerContextId,
        item.containerId,
        item.composeDir,
      )) {
        const lines = item.tailLines > 0 ? item.tailLines : 200
        await fetchTailConfig(sourceToDO(item, lines), lines)
      }
    })()
  }, [refreshList, loadEditor, fetchTailConfig])

  useWorkbenchCommand(Capability.LogsOpen, (cmd) => {
    const logSourceId = payloadStr(cmd.payload, 'logSourceId')
    const sourceTypeRaw = payloadStr(cmd.payload, 'sourceType')
    const nameHint = payloadStr(cmd.payload, 'name')
    const pathHint = payloadStr(cmd.payload, 'path') ?? ''
    const sshHostIdHint = payloadStr(cmd.payload, 'sshHostId') ?? ''
    const dockerContextIdHint = payloadStr(cmd.payload, 'dockerContextId') ?? ''
    const containerIdHint = payloadStr(cmd.payload, 'containerId') ?? ''
    const composeDirHint = payloadStr(cmd.payload, 'composeDir') ?? ''
    const composeServiceHint = payloadStr(cmd.payload, 'composeService') ?? ''
    const shouldFetch = cmd.payload.fetch === undefined ? true : payloadBool(cmd.payload, 'fetch')

    void (async () => {
      try {
        const list = await refreshList()
        let target = logSourceId ? list.find((i) => i.id === logSourceId) : undefined

        const st = (SOURCE_TYPES.includes(sourceTypeRaw as LogSourceType)
          ? sourceTypeRaw
          : undefined) as LogSourceType | undefined

        if (!target && st === 'docker' && dockerContextIdHint && containerIdHint) {
          target = list.find(
            (i) =>
              i.sourceType === 'docker' &&
              i.dockerContextId === dockerContextIdHint &&
              i.containerId === containerIdHint,
          )
        }
        if (!target && st === 'ssh_file' && sshHostIdHint && pathHint) {
          target = list.find(
            (i) => i.sourceType === 'ssh_file' && i.sshHostId === sshHostIdHint && i.path === pathHint,
          )
        }

        // SSH 无路径：只起草表单，不落空资产
        if (!target && (st === 'ssh_file' || (!st && sshHostIdHint && !pathHint && !dockerContextIdHint)) && sshHostIdHint && !pathHint) {
          setActiveId('')
          setName(nameHint || t('logs.newSource'))
          setSourceType('ssh_file')
          setPath('')
          setSSHHostId(sshHostIdHint)
          setDockerContextId('')
          setContainerId('')
          setComposeDir('')
          setComposeService('')
          setTailLines(200)
          setContent('')
          setFollowLive(false)
          resetHistoryCursor('')
          setStatusMessage(t('logs.draftSSH'))
          return
        }

        if (!target && (st || dockerContextIdHint || (sshHostIdHint && pathHint) || pathHint)) {
          const sourceType: LogSourceType = st ?? (dockerContextIdHint ? 'docker' : sshHostIdHint ? 'ssh_file' : 'local_file')
          const label =
            nameHint ||
            (sourceType === 'docker' ? containerIdHint.slice(0, 12) || 'docker' : pathHint || t('logs.newSource'))
          const saved = (await api.saveLogSource(
            model.LogSourceDO.createFrom({
              id: '',
              name: label,
              sourceType,
              path: pathHint,
              sshHostId: sshHostIdHint,
              dockerContextId: dockerContextIdHint,
              containerId: containerIdHint,
              composeDir: composeDirHint,
              composeService: composeServiceHint,
              tailLines: 200,
              sortOrder: 0,
              createdAt: 0,
              updatedAt: 0,
            }),
          )) as LogSource
          const next = await refreshList()
          target = next.find((i) => i.id === saved.id) ?? saved
          setStatusMessage(t('logs.saved'))
        }

        if (!target) {
          setStatusMessage(t('logs.emptyList'))
          return
        }

        setActiveId(target.id)
        loadEditor(target)
        setFollowLive(false)
        setContent('')

        if (shouldFetch && canFetchLogConfig(
          target.sourceType,
          target.path,
          target.sshHostId,
          target.dockerContextId,
          target.containerId,
          target.composeDir,
        )) {
          const lines = target.tailLines > 0 ? target.tailLines : 200
          await fetchTailConfig(sourceToDO(target, lines), lines)
        }
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  })

  useEffect(() => {
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain !== 'logs.source') return
      const list = await refreshList()
      const id = evt.ids[0]
      if (evt.op === 'delete' && id && activeId === id) {
        const next = list[0] ?? null
        setActiveId(next?.id ?? '')
        loadEditor(next)
        setFollowLive(false)
        setContent('')
        resetHistoryCursor('')
      } else if (evt.reveal && id && evt.op !== 'delete') {
        const item = list.find((x) => x.id === id) ?? null
        if (item) {
          setActiveId(id)
          loadEditor(item)
        }
      }
      if (evt.label) {
        useAppStore.getState().setStatusMessage(
          evt.op === 'delete' ? `日志源已删除：${evt.label}` : `日志源已更新：${evt.label}`,
        )
      }
    }
    for (const evt of takePendingWorkbenchChanged('logs.')) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [refreshList, loadEditor, activeId, resetHistoryCursor])

  useEffect(() => {
    scheduleLogsWorkspacePersist({ version: 1, activeId })
  }, [activeId])

  const selectItem = (item: LogSource) => {
    setActiveId(item.id)
    loadEditor(item)
    setFollowLive(false)
    setContent('')
    resetHistoryCursor('')
    if (canFetchLogConfig(
      item.sourceType,
      item.path,
      item.sshHostId,
      item.dockerContextId,
      item.containerId,
      item.composeDir,
    )) {
      const lines = item.tailLines > 0 ? item.tailLines : 200
      void fetchTailConfig(sourceToDO(item, lines), lines)
    }
  }

  const createNew = () => {
    setActiveId('')
    loadEditor(null)
    setFollowLive(false)
    setContent('')
    resetHistoryCursor('')
  }

  useEffect(() => {
    return subscribeLogsChunks((evt) => {
      if (!followStreamId.current || evt.streamId !== followStreamId.current) return
      if (evt.reset) {
        applyTailContent(evt.chunk)
        return
      }
      if (!evt.chunk) return
      const added = evt.chunk.startsWith('\n') ? evt.chunk.slice(1) : evt.chunk
      const addedCount = countContentLines(added)
      if (addedCount > 0) {
        oldestSkipRef.current += addedCount
      }
      setContent((prev) => prev + evt.chunk)
      if (stickToBottomRef.current) {
        requestAnimationFrame(scrollToBottom)
      }
    })
  }, [applyTailContent, scrollToBottom])

  useEffect(() => {
    if (!followLive || !fetchReady) {
      if (followStreamId.current) {
        void api.stopLogFollow(followStreamId.current)
        followStreamId.current = ''
      }
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const id = await api.startLogFollow(buildSourceConfig(), tailLines)
        if (cancelled) {
          void api.stopLogFollow(id)
          return
        }
        followStreamId.current = id
        stickToBottomRef.current = true
        setStatusMessage(t('logs.followOn'))
      } catch (e) {
        setFollowLive(false)
        setStatusMessage((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
      if (followStreamId.current) {
        void api.stopLogFollow(followStreamId.current)
        followStreamId.current = ''
      }
    }
  }, [followLive, fetchReady, buildSourceConfig, tailLines, setStatusMessage, t])

  const save = async () => {
    if (!name.trim()) {
      setStatusMessage(t('logs.errName'))
      return
    }
    const saved = (await api.saveLogSource(
      model.LogSourceDO.createFrom({
        id: activeId,
        name: name.trim(),
        sourceType,
        path: path.trim(),
        sshHostId,
        dockerContextId,
        containerId,
        composeDir: composeDir.trim(),
        composeService: composeService.trim(),
        tailLines,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    )) as LogSource
    setActiveId(saved.id)
    await refreshList()
    setStatusMessage(t('logs.saved'))
  }

  const pickLogFile = async () => {
    try {
      const p = await api.pickLogFilePath()
      if (p) setPath(p)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const pickComposeDir = async () => {
    if (!dockerContextId) return
    try {
      const dir = await api.pickDockerComposeDirectory(dockerContextId)
      if (dir) setComposeDir(dir)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const onViewerScroll = () => {
    const el = preRef.current
    if (!el) return
    const distBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distBottom < 48
    if (el.scrollTop < 48) {
      void loadOlder()
    }
  }

  const followDisabled = !fetchReady || contentLoading.active

  return (
    <div className="product-workbench logs-workbench">
      <header className="product-toolbar logs-toolbar">
        <div className="product-actions">
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            disabled={contentLoading.active || !fetchReady}
            {...pressProps(() => void refreshLogs(), { disabled: contentLoading.active || !fetchReady })}
          >
            <IconRefresh size={14} /> {t('logs.refresh')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void save())}>
            {t('logs.save')}
          </button>
          {activeItem && (
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-tool"
              {...pressProps(() => sendToAgent(activeItem))}
            >
              {t('agent.sendToAgent')}
            </button>
          )}
          <label
            className={`logs-auto-label${followDisabled ? ' is-disabled' : ''}`}
            {...pressProps(
              () => {
                if (followDisabled) return
                setFollowLive((v) => !v)
              },
              { disabled: followDisabled },
            )}
          >
            <input type="checkbox" checked={followLive} readOnly tabIndex={-1} disabled={followDisabled} />
            {t('logs.followLive')}
          </label>
        </div>
      </header>

      <div className="product-body">
        <aside className="app-sidebar logs-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('products.logs.label')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('logs.newSource')} {...pressProps(createNew)}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {items.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title={t('logs.emptyList')}
                  hint={t('logs.emptyListHint')}
                  actions={[{ label: t('logs.newSource'), onPress: createNew, primary: true }]}
                />
              ) : (
                <ul className="conn-list">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`conn-item ${item.id === activeId ? 'active' : ''}`}
                      {...pressProps(() => selectItem(item))}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({ x: e.clientX, y: e.clientY, item })
                      }}
                    >
                      <div className="conn-meta">
                        <span className="conn-name">{item.name}</span>
                        <span className="conn-host">{t(TYPE_LABEL_KEYS[item.sourceType])}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <main className="app-main logs-main">
          <div className="logs-config">
            <div className="logs-row logs-row-2">
              <div className="logs-field">
                <label className="wn-label">{t('logs.name')}</label>
                <input className="wn-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('logs.namePlaceholder')} />
              </div>
              <div className="logs-field logs-field-narrow">
                <label className="wn-label">{t('logs.tailLines')}</label>
                <input
                  className="wn-input"
                  type="number"
                  min={10}
                  max={5000}
                  value={tailLines}
                  onChange={(e) => setTailLines(Number(e.target.value) || 200)}
                />
              </div>
            </div>
            <div className="logs-row">
              <label className="wn-label">{t('logs.sourceType')}</label>
              <Select
                value={sourceType}
                options={SOURCE_TYPES.map((ty) => ({
                  value: ty,
                  label: t(TYPE_LABEL_KEYS[ty]),
                }))}
                onChange={(v) => setSourceType(v as LogSourceType)}
              />
            </div>

            {sourceType === 'local_file' && (
              <div className="logs-row logs-row-compose-dir">
                <label className="wn-label">{t('logs.path')}</label>
                <input className="wn-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('logs.pathPlaceholder')} />
                <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void pickLogFile())}>
                  {t('logs.pickFile')}
                </button>
              </div>
            )}

            {sourceType === 'ssh_file' && (
              <>
                <div className="logs-row">
                  <label className="wn-label">{t('logs.sshHost')}</label>
                  <Select
                    value={sshHostId}
                    options={[
                      { value: '', label: t('logs.selectHost') },
                      ...sshHosts.map((h) => ({
                        value: h.id,
                        label: `${h.name} (${h.host})`,
                      })),
                    ]}
                    onChange={setSSHHostId}
                  />
                </div>
                <div className="logs-row">
                  <label className="wn-label">{t('logs.path')}</label>
                  <input className="wn-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('logs.pathPlaceholder')} />
                </div>
                <p className="logs-field-hint">{t('logs.pathHintSSH')}</p>
              </>
            )}

            {(sourceType === 'docker' || sourceType === 'compose') && (
              <div className="logs-row">
                <label className="wn-label">{t('logs.dockerContext')}</label>
                <Select
                  value={dockerContextId}
                  options={[
                    { value: '', label: t('logs.selectContext') },
                    ...dockerContexts.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  onChange={setDockerContextId}
                />
              </div>
            )}

            {sourceType === 'docker' && (
              <div className="logs-row">
                <label className="wn-label">{t('logs.container')}</label>
                <Select
                  value={containerId}
                  options={[
                    { value: '', label: t('logs.selectContainer') },
                    ...containers.map((c) => ({
                      value: c.id,
                      label: `${c.name} (${c.image})`,
                    })),
                  ]}
                  onChange={setContainerId}
                />
              </div>
            )}

            {sourceType === 'compose' && (
              <>
                <div className="logs-row logs-row-compose-dir">
                  <label className="wn-label">{t('logs.composeDir')}</label>
                  <input
                    className="wn-input"
                    value={composeDir}
                    onChange={(e) => setComposeDir(e.target.value)}
                    placeholder={t('logs.composeDirPlaceholder')}
                  />
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void pickComposeDir())}>
                    {t('logs.pickComposeDir')}
                  </button>
                </div>
                <div className="logs-row">
                  <label className="wn-label">{t('logs.composeService')}</label>
                  <input
                    className="wn-input"
                    value={composeService}
                    onChange={(e) => setComposeService(e.target.value)}
                    placeholder={t('logs.composeServicePlaceholder')}
                  />
                </div>
              </>
            )}
          </div>

          <div className="logs-viewer">
            <header className="logs-viewer-head">
              <span className="wn-label">{t('logs.logOutput')}</span>
              <div className="logs-viewer-meta">
                <span>{t('logs.tailLines')}: {tailLines}</span>
                {loadingOlder && <span>{t('logs.loadingOlder')}</span>}
                {!hasMoreOlder && content ? <span>{t('logs.noMoreOlder')}</span> : null}
                {followLive && <span className="logs-live-badge">{t('logs.followLive')}</span>}
              </div>
            </header>
            <div className="logs-viewer-body">
              <LoadingPane loadingKey={LOGS_LOADING_CONTENT} label={t('logs.refreshing')} minHeight={280}>
                {!content ? (
                  <EmptyState
                    variant="pane"
                    title={t('logs.noOutput')}
                    hint={t('logs.noOutputHint')}
                    actions={[
                      {
                        label: t('logs.refresh'),
                        onPress: () => void refreshLogs(),
                        primary: true,
                      },
                      {
                        label: t('logs.tryFollow'),
                        onPress: () => {
                          if (!fetchReady) {
                            setStatusMessage(t('logs.errConfig'))
                            return
                          }
                          setFollowLive(true)
                        },
                      },
                    ]}
                  />
                ) : (
                  <pre ref={preRef} className="logs-pre" onScroll={onViewerScroll}>
                    {content.split('\n').map((line, index, lines) => {
                      const tone = logLineTone(line)
                      return (
                        <span key={index} className={`logs-line${tone ? ` is-${tone}` : ''}`}>
                          {line}{index < lines.length - 1 ? '\n' : null}
                        </span>
                      )
                    })}
                  </pre>
                )}
              </LoadingPane>
            </div>
          </div>
        </main>
      </div>

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
              const item = ctxMenu.item
              setCtxMenu(null)
              sendToAgent(item)
            })}
          >
            {t('agent.sendToAgent')}
          </button>
          <button
            type="button"
            className="wn-context-item wn-context-item-danger"
            {...pressProps(() => {
              setDeleteTarget(ctxMenu.item)
              setCtxMenu(null)
            })}
          >
            {t('common.delete')}
          </button>
        </ContextMenu>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('logs.deleteTitle')}
        message={deleteTarget ? t('logs.deleteMsg', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          const item = deleteTarget
          setDeleteTarget(null)
          if (!item) return
          void api.deleteLogSource(item.id).then(async () => {
            if (activeId === item.id) {
              setActiveId('')
              loadEditor(null)
              setFollowLive(false)
              setContent('')
              resetHistoryCursor('')
            }
            await refreshList()
            setStatusMessage(t('logs.deleted'))
          })
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

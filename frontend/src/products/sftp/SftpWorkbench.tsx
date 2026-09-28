import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, SftpBookmark, ShellHost, SSHHost } from '../../api/types'
import { shellHostAsSSH } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { IconPlus, IconServer } from '../../components/Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildSftpSurface, briefList } from '../../stores/agentSurface'
import { openAgentDraft, mentionSSH, mentionDockerHost } from '../../features/agent/openAgentDraft'
import { openNotebook, openTerminal, openLogs, openSSHForward, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { restoreSftpTab } from '../../features/sftp/restoreSftpWorkspace'
import { pressProps, useDismissOverlays } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'
import { useLoading, withLoading } from '../../stores/loadingStore'
import {
  loadSftpWorkspace,
  scheduleSftpWorkspacePersist,
  toSftpWorkspaceSnapshot,
} from '../../stores/sftpWorkspacePersist'
import { SSHHostModal } from '../../features/terminal/SSHHostModal'
import { useSSHTrustConfirm } from '../../features/terminal/useSSHTrustConfirm'
import { FilePane } from '../../features/sftp/FilePane'
import { SftpPrompt, type SftpPromptMode } from '../../features/sftp/SftpPrompt'
import {
  SftpTransferModal,
  type StagedTransfer,
  type TransferModalMode,
} from '../../features/sftp/SftpTransferModal'
import { SftpTextEditor } from '../../features/sftp/SftpTextEditor'
import { SftpImagePreview } from '../../features/sftp/SftpImagePreview'
import { isProbablyImageFile, isProbablyTextFile, imageMimeFromName } from '../../features/sftp/sftpTextLanguage'
import { useFileSelection } from '../../features/sftp/useFileSelection'
import { useSftpFileDrop } from '../../features/sftp/useSftpFileDrop'
import { useScrollActiveTabIntoView } from '../../hooks/useScrollActiveTabIntoView'
import { useSftpTransferQueue } from '../../features/sftp/useSftpTransferQueue'
import { useSftpConflictResolver } from '../../features/sftp/useSftpConflictResolver'
import { filterPathsWithConflict } from '../../features/sftp/transferConflict'
import { joinRemotePath, parentRemotePath, shellSingleQuote, siblingPath } from '../../features/sftp/sftpUtils'

const SFTP_SIDE_TAB_KEY = 'sftp_sidebar_tab'
type SftpSideTab = 'ssh' | 'docker'

function loadSftpSideTab(): SftpSideTab {
  try {
    const v = localStorage.getItem(SFTP_SIDE_TAB_KEY)
    if (v === 'ssh' || v === 'docker') return v
  } catch {
    /* ignore */
  }
  return 'ssh'
}

function persistSftpSideTab(tab: SftpSideTab) {
  try {
    localStorage.setItem(SFTP_SIDE_TAB_KEY, tab)
  } catch {
    /* ignore */
  }
}

interface SftpTab {
  id: string
  sessionId: string
  hostId: string
  title: string
  /** 本地下载默认目录（单栏模式下不再展示本地列表，仍用于工作区恢复）。 */
  localPath: string
  remotePath: string
}

interface PromptState {
  mode: SftpPromptMode
  title: string
  message?: string
  defaultValue?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
}

/** SFTP 产品线工作区 */
export function SftpWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [hosts, setHosts] = useState<ShellHost[]>([])
  const [tabs, setTabs] = useState<SftpTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [remoteFiles, setRemoteFiles] = useState<FileEntry[]>([])
  const remoteSel = useFileSelection(remoteFiles)
  const [remoteBookmarks, setRemoteBookmarks] = useState<SftpBookmark[]>([])
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [hostModalOpen, setHostModalOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; host: ShellHost } | null>(null)
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferMode, setTransferMode] = useState<TransferModalMode>('upload')
  const [stagedTransfers, setStagedTransfers] = useState<StagedTransfer[]>([])
  const [downloadLocalDir, setDownloadLocalDir] = useState('')
  const [flashPaths, setFlashPaths] = useState<string[]>([])
  const [textEditor, setTextEditor] = useState<{
    path: string
    name: string
    content: string
    revision: number
  } | null>(null)
  const [textSaving, setTextSaving] = useState(false)
  const [imagePreview, setImagePreview] = useState<{
    path: string
    name: string
    src: string
    size: number
  } | null>(null)
  const [sideTab, setSideTab] = useState<SftpSideTab>(() => loadSftpSideTab())
  const workspaceRestored = useRef(false)
  /** 防止系统文件框关闭后点击穿透再次唤起选文件。 */
  const pickingRef = useRef(false)
  const flashTimerRef = useRef<number | null>(null)

  useDismissOverlays(() => {
    setCtxMenu(null)
    setPaneMenu(null)
    setTabCtxMenu(null)
  })

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const listLoading = useLoading(activeTab ? `sftp.list.${activeTab.id}` : 'sftp.list._')
  const tabsRef = useScrollActiveTabIntoView(activeTabId)

  useEffect(() => {
    if (activeProduct !== 'sftp') return
    const host = activeTab ? hosts.find((h) => h.id === activeTab.hostId) : undefined
    setAgentSurface(
      buildSftpSurface({
        title: activeTab?.title,
        hostId: activeTab?.hostId,
        hostLabel: host?.name?.trim() || host?.host || activeTab?.title,
        hostKind: host?.kind === 'docker' ? 'docker' : host?.kind === 'ssh' ? 'ssh' : '',
        remotePath: activeTab?.remotePath,
        remoteSelected: remoteSel.selectedPaths,
        openTabsBrief: briefList(
          tabs.map((t) => t.title),
          12,
        ),
      }),
    )
  }, [
    activeProduct,
    activeTab,
    hosts,
    tabs,
    remoteSel.selectedPaths,
    setAgentSurface,
  ])

  const refreshHosts = useCallback(async () => {
    try {
      setHosts(await api.listShellHosts())
    } catch (e) {
      setHosts([])
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage])

  const loadBookmarks = useCallback(async () => {
    try {
      if (activeTab) {
        setRemoteBookmarks(await api.listSFTPBookmarks('remote', activeTab.hostId))
      } else {
        setRemoteBookmarks([])
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }, [activeTab?.hostId, setStatusMessage])

  useEffect(() => {
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain === 'ssh.host') {
        await refreshHosts()
        if (evt.label) {
          useAppStore.getState().setStatusMessage(
            evt.op === 'delete' ? `SSH 主机已删除：${evt.label}` : `SSH 主机已更新：${evt.label}`,
          )
        }
        return
      }
      if (evt.domain !== 'sftp.bookmark') return
      await loadBookmarks()
      if (evt.label) {
        useAppStore.getState().setStatusMessage(
          evt.op === 'delete' ? `书签已删除：${evt.label}` : `书签已更新：${evt.label}`,
        )
      }
    }
    for (const evt of takePendingWorkbenchChanged('ssh.host')) void apply(evt)
    for (const evt of takePendingWorkbenchChanged('sftp.')) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [refreshHosts, loadBookmarks])

  useEffect(() => {
    if (workspaceRestored.current) {
      refreshHosts()
      loadBookmarks()
      return
    }
    workspaceRestored.current = true
    void (async () => {
      try {
        const hostList = await api.listShellHosts()
        setHosts(hostList)
        const snap = await loadSftpWorkspace()
        if (!snap?.tabs.length) return
        const restored: SftpTab[] = []
        for (const tabSnap of snap.tabs) {
          try {
            const tab = await restoreSftpTab(tabSnap, hostList, confirmTrust)
            if (tab) restored.push(tab)
          } catch {
            /* 跳过无法恢复的会话 */
          }
        }
        if (!restored.length) return
        setTabs(restored)
        const idx = Math.min(Math.max(0, snap.activeTabIndex), restored.length - 1)
        setActiveTabId(restored[idx].id)
        setStatusMessage(t('sftp.restored', { count: restored.length }))
      } catch (e) {
        setHosts([])
        setStatusMessage((e as Error).message)
      }
    })()
  }, [refreshHosts, loadBookmarks, setStatusMessage, confirmTrust])

  useEffect(() => {
    scheduleSftpWorkspacePersist(toSftpWorkspaceSnapshot(tabs, activeTabId))
  }, [tabs, activeTabId])

  useEffect(() => {
    if (!ctxMenu && !paneMenu && !tabCtxMenu) return
    const close = () => {
      setCtxMenu(null)
      setPaneMenu(null)
      setTabCtxMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [ctxMenu, paneMenu, tabCtxMenu])

  const loadRemote = useCallback(async (sessionId: string, path: string) => {
    return api.listSFTPDir(sessionId, path)
  }, [])

  /** 静默刷新：保留当前列表，避免 LoadingPane 闪屏。 */
  const softRefreshRemote = useCallback(async () => {
    if (!activeTab) return
    const remoteList = await loadRemote(activeTab.sessionId, activeTab.remotePath)
    setRemoteFiles(remoteList)
    const alive = new Set(remoteList.map((e) => e.path))
    remoteSel.setSelectedPaths((prev) => prev.filter((p) => alive.has(p)))
  }, [activeTab, loadRemote, remoteSel.setSelectedPaths])

  /** 切换路径/首次进入：清空并走 LoadingPane。 */
  const refreshRemote = useCallback(async () => {
    if (!activeTab) return
    const key = `sftp.list.${activeTab.id}`
    await withLoading(
      key,
      async () => {
        const remoteList = await loadRemote(activeTab.sessionId, activeTab.remotePath)
        setRemoteFiles(remoteList)
        remoteSel.clearSelection()
      },
      {
        label: t('common.loading'),
        onBegin: () => setRemoteFiles([]),
      },
    )
  }, [activeTab, loadRemote, remoteSel.clearSelection, t])

  const refreshActive = useCallback(async () => {
    await refreshRemote()
  }, [refreshRemote])

  const conflictResolver = useSftpConflictResolver()

  const markUploadFlash = useCallback(
    (tasks: { name: string; state: string; kind: string; targetDir: string }[]) => {
      if (!activeTab) return
      const uploads = tasks.filter((x) => x.kind === 'upload' && x.state === 'done' && x.targetDir === activeTab.remotePath)
      if (!uploads.length) return
      const nextFlash = uploads.map((u) => joinRemotePath(activeTab.remotePath, u.name))
      setFlashPaths(nextFlash)
      setStatusMessage(t('sftp.wroteFiles', { count: uploads.length, path: activeTab.remotePath }))
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = window.setTimeout(() => setFlashPaths([]), 3200)
    },
    [activeTab, setStatusMessage, t],
  )

  const transferQueue = useSftpTransferQueue((tasks) => {
    softRefreshRemote()
      .then(() => {
        markUploadFlash(tasks)
        const downloads = tasks.filter((x) => x.kind === 'download' && x.state === 'done')
        if (downloads.length) {
          const dir = downloads[0]?.targetDir || ''
          setStatusMessage(t('sftp.downloadedFiles', { count: downloads.length, path: dir }))
        }
      })
      .catch((e) => setStatusMessage((e as Error).message))
  })

  useEffect(() => {
    if (!activeTab) {
      setRemoteFiles([])
      return
    }
    refreshActive().catch((e) => setStatusMessage((e as Error).message))
    loadBookmarks()
  }, [activeTab?.id, activeTab?.remotePath])

  const updateActiveTab = (patch: Partial<SftpTab>) => {
    if (!activeTab) return
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, ...patch } : t)))
  }

  const connectHost = async (host: ShellHost) => {
    if (connectingId) return
    if (host.kind === 'docker' && host.running === false) {
      setStatusMessage(t('sftp.containerStoppedHint', { name: host.name }))
      return
    }
    setConnectingId(host.id)
    setStatusMessage(t('sftp.connecting', { name: host.name }))
    try {
      const open = () => api.openSFTPSession(host.id)
      const info =
        host.kind === 'docker'
          ? await open()
          : await withSSHHostTrust(host.host || '', host.port || 22, open, confirmTrust)
      const remoteHome = await api.getSFTPHome(info.sessionId)
      const local = await api.listLocalDir('')
      const tab: SftpTab = {
        id: `sftp-${info.sessionId}`,
        sessionId: info.sessionId,
        hostId: host.id,
        title: info.title || host.name,
        localPath: local.path,
        remotePath: remoteHome,
      }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
      setStatusMessage(t('sftp.connected', { title: tab.title }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setConnectingId(null)
    }
  }

  useWorkbenchCommand(Capability.SftpOpen, (cmd) => {
    const hostId = payloadStr(cmd.payload, 'hostId')
    if (!hostId) return
    void (async () => {
      try {
        let host = hosts.find((h) => h.id === hostId)
        if (!host) {
          host = await api.getShellHost(hostId)
          setHosts((prev) => (prev.some((h) => h.id === hostId) ? prev : [...prev, host!]))
        }
        await connectHost(host)
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  })

  const closeTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) {
      try {
        await api.closeSFTPSession(tab.sessionId)
      } catch {
        /* ignore */
      }
    }
    const next = tabs.filter((t) => t.id !== tabId)
    setTabs(next)
    if (activeTabId === tabId) setActiveTabId(next.length ? next[next.length - 1].id : null)
  }

  /** closeOtherTabs 关闭除当前外的 SFTP 标签。 */
  const closeOtherTabs = async (keepId: string) => {
    const closing = tabs.filter((t) => t.id !== keepId)
    for (const tab of closing) {
      try {
        await api.closeSFTPSession(tab.sessionId)
      } catch {
        /* ignore */
      }
    }
    setTabs(tabs.filter((t) => t.id === keepId))
    setActiveTabId(keepId)
  }

  /** closeAllTabs 关闭全部 SFTP 标签。 */
  const closeAllTabs = async () => {
    for (const tab of tabs) {
      try {
        await api.closeSFTPSession(tab.sessionId)
      } catch {
        /* ignore */
      }
    }
    setTabs([])
    setActiveTabId(null)
  }

  const runMutating = async (label: string, fn: () => Promise<void>) => {
    if (!activeTab || mutating) return
    setMutating(true)
    setStatusMessage(label)
    try {
      await fn()
      await softRefreshRemote()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setMutating(false)
    }
  }

  const requestUpload = useCallback(
    async (paths: string[]) => {
      if (!activeTab || paths.length === 0) return
      const accepted = await filterPathsWithConflict(
        'upload',
        activeTab.sessionId,
        paths,
        activeTab.remotePath,
        conflictResolver.ask
      )
      if (!accepted.length) return
      transferQueue.enqueueUpload(activeTab.sessionId, accepted, activeTab.remotePath)
      setStatusMessage(t('sftp.queuedUpload', { count: accepted.length }))
    },
    [activeTab, conflictResolver.ask, transferQueue.enqueueUpload, setStatusMessage, t]
  )

  const requestDownload = useCallback(
    async (paths: string[], localDir: string) => {
      if (!activeTab || paths.length === 0 || !localDir) return
      const accepted = await filterPathsWithConflict(
        'download',
        activeTab.sessionId,
        paths,
        localDir,
        conflictResolver.ask
      )
      if (!accepted.length) return
      transferQueue.enqueueDownload(activeTab.sessionId, accepted, localDir)
      setStatusMessage(t('sftp.queuedDownload', { count: accepted.length }))
    },
    [activeTab, conflictResolver.ask, transferQueue.enqueueDownload, setStatusMessage, t]
  )

  const stageUploadPaths = useCallback((paths: string[]) => {
    if (!paths.length) return
    setTransferMode((mode) => {
      setStagedTransfers((prev) => {
        const base = mode === 'upload' ? prev : []
        const seen = new Set(base.map((p) => p.path))
        const next = [...base]
        for (const path of paths) {
          if (seen.has(path)) continue
          seen.add(path)
          const parts = path.replace(/\\/g, '/').split('/')
          next.push({ id: crypto.randomUUID(), path, name: parts[parts.length - 1] || path })
        }
        return next
      })
      return 'upload'
    })
    setTransferOpen(true)
  }, [])

  const stageDownloadPaths = useCallback((paths: string[], localDir: string) => {
    if (!paths.length || !localDir) return
    setTransferMode('download')
    setDownloadLocalDir(localDir)
    setStagedTransfers(
      paths.map((path) => {
        const parts = path.replace(/\\/g, '/').split('/')
        return { id: crypto.randomUUID(), path, name: parts[parts.length - 1] || path }
      }),
    )
    setTransferOpen(true)
  }, [])

  /** 先选本地文件，再打开上传弹窗（避开系统框关闭后的点击穿透）。 */
  const handleUpload = () => {
    if (!activeTab || pickingRef.current) return
    pickingRef.current = true
    const wasOpen = transferOpen
    if (wasOpen) setTransferOpen(false)
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 80))
        const paths = await api.pickSFTPUploadPaths()
        if (!paths.length) {
          if (wasOpen) setTransferOpen(true)
          return
        }
        stageUploadPaths(paths)
      } catch (e) {
        if (wasOpen) setTransferOpen(true)
        setStatusMessage((e as Error).message)
      } finally {
        window.setTimeout(() => {
          pickingRef.current = false
        }, 280)
      }
    })()
  }

  /** 先选本地文件夹，再打开上传弹窗。 */
  const handleUploadFolder = () => {
    if (!activeTab || pickingRef.current) return
    pickingRef.current = true
    const wasOpen = transferOpen
    if (wasOpen) setTransferOpen(false)
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 80))
        const dir = await api.pickSFTPUploadDir()
        if (!dir) {
          if (wasOpen) setTransferOpen(true)
          return
        }
        stageUploadPaths([dir])
      } catch (e) {
        if (wasOpen) setTransferOpen(true)
        setStatusMessage((e as Error).message)
      } finally {
        window.setTimeout(() => {
          pickingRef.current = false
        }, 280)
      }
    })()
  }

  const startStagedTransfers = () => {
    if (!activeTab || !stagedTransfers.length) return
    const paths = stagedTransfers.map((s) => s.path)
    setStagedTransfers([])
    if (transferMode === 'upload') {
      requestUpload(paths).catch((e) => setStatusMessage((e as Error).message))
      return
    }
    const dir = downloadLocalDir || activeTab.localPath
    if (!dir) {
      setStatusMessage(t('sftp.pickDownloadDir'))
      return
    }
    requestDownload(paths, dir).catch((e) => setStatusMessage((e as Error).message))
  }

  /** 勾选远程项后下载：选目录 → 入下载队列弹窗 → 开始下载。 */
  const handleDownload = (paths?: string[]) => {
    if (!activeTab || pickingRef.current) return
    const selected = paths ?? remoteSel.selectedPaths
    if (!selected.length) {
      setStatusMessage(t('sftp.pickDownload'))
      return
    }
    pickingRef.current = true
    const wasOpen = transferOpen
    if (wasOpen) setTransferOpen(false)
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 80))
        const dir = await api.pickSFTPDownloadDir(downloadLocalDir || activeTab.localPath || '')
        if (!dir) {
          if (wasOpen) setTransferOpen(true)
          return
        }
        updateActiveTab({ localPath: dir })
        stageDownloadPaths(selected, dir)
      } catch (e) {
        if (wasOpen) setTransferOpen(true)
        setStatusMessage((e as Error).message)
      } finally {
        window.setTimeout(() => {
          pickingRef.current = false
        }, 280)
      }
    })()
  }

  const handleChangeDownloadDir = () => {
    if (!activeTab || pickingRef.current) return
    pickingRef.current = true
    const wasOpen = transferOpen
    if (wasOpen) setTransferOpen(false)
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 80))
        const dir = await api.pickSFTPDownloadDir(downloadLocalDir || activeTab.localPath || '')
        if (!dir) {
          if (wasOpen) setTransferOpen(true)
          return
        }
        updateActiveTab({ localPath: dir })
        setDownloadLocalDir(dir)
        setTransferMode('download')
        setTransferOpen(true)
      } catch (e) {
        if (wasOpen) setTransferOpen(true)
        setStatusMessage((e as Error).message)
      } finally {
        window.setTimeout(() => {
          pickingRef.current = false
        }, 280)
      }
    })()
  }

  const openTextEditor = useCallback(
    (entry: FileEntry) => {
      if (!activeTab || entry.isDir) return
      void (async () => {
        try {
          setStatusMessage(t('sftp.editorLoading'))
          const file = await api.readSFTPText(activeTab.sessionId, entry.path)
          setTextEditor({
            path: file.path,
            name: file.name || entry.name,
            content: file.content,
            revision: Date.now(),
          })
          setStatusMessage('')
        } catch (e) {
          setStatusMessage((e as Error).message)
        }
      })()
    },
    [activeTab, setStatusMessage, t],
  )

  const openImagePreview = useCallback(
    (entry: FileEntry) => {
      if (!activeTab || entry.isDir) return
      void (async () => {
        try {
          setStatusMessage(t('sftp.imageLoading'))
          const file = await api.readSFTPBinary(activeTab.sessionId, entry.path)
          const mime = file.mime || imageMimeFromName(file.name || entry.name)
          setImagePreview({
            path: file.path,
            name: file.name || entry.name,
            src: `data:${mime};base64,${file.content}`,
            size: file.size,
          })
          setStatusMessage('')
        } catch (e) {
          setStatusMessage((e as Error).message)
        }
      })()
    },
    [activeTab, setStatusMessage, t],
  )

  const reloadTextEditor = useCallback(() => {
    if (!activeTab || !textEditor) return
    void (async () => {
      try {
        const file = await api.readSFTPText(activeTab.sessionId, textEditor.path)
        setTextEditor({
          path: file.path,
          name: file.name || textEditor.name,
          content: file.content,
          revision: Date.now(),
        })
        setStatusMessage(t('sftp.editorReloaded'))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }, [activeTab, textEditor, setStatusMessage, t])

  const saveTextEditor = useCallback(() => {
    if (!activeTab || !textEditor || textSaving) return
    setTextSaving(true)
    void (async () => {
      try {
        await api.writeSFTPText(activeTab.sessionId, textEditor.path, textEditor.content)
        setTextEditor((prev) => (prev ? { ...prev, revision: Date.now() } : prev))
        setStatusMessage(t('sftp.editorSaved', { name: textEditor.name }))
        softRefreshRemote().catch(() => {})
      } catch (e) {
        setStatusMessage((e as Error).message)
      } finally {
        setTextSaving(false)
      }
    })()
  }, [activeTab, textEditor, textSaving, setStatusMessage, softRefreshRemote, t])

  const handleOpenFile = (entry: FileEntry) => {
    if (isProbablyImageFile(entry.name)) {
      openImagePreview(entry)
      return
    }
    if (isProbablyTextFile(entry.name)) {
      openTextEditor(entry)
      return
    }
    handleDownload([entry.path])
  }

  const handleOsFileDrop = useCallback(
    (paths: string[]) => {
      stageUploadPaths(paths)
    },
    [stageUploadPaths],
  )

  useSftpFileDrop(!!activeTab, handleOsFileDrop)

  const addBookmark = async () => {
    if (!activeTab) return
    try {
      await api.saveSFTPBookmark({
        id: '',
        side: 'remote',
        hostId: activeTab.hostId,
        name: '',
        path: activeTab.remotePath,
        createdAt: 0,
      })
      await loadBookmarks()
      setStatusMessage(t('sftp.bookmarkAdded'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const deleteBookmark = async (id: string) => {
    try {
      await api.deleteSFTPBookmark(id)
      await loadBookmarks()
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const openMkdir = () => {
    if (!activeTab) return
    setPrompt({
      mode: 'mkdir',
      title: t('sftp.newRemoteFolder'),
      onSubmit: (name) => {
        setPrompt(null)
        if (!name.trim()) return
        runMutating(t('sftp.creating'), async () => {
          await api.mkdirSFTPRemote(activeTab.sessionId, joinRemotePath(activeTab.remotePath, name.trim()))
          setStatusMessage(t('sftp.folderCreated'))
        })
      },
    })
  }

  const openRename = (entry: FileEntry) => {
    if (!activeTab) return
    setPrompt({
      mode: 'rename',
      title: t('sftp.rename'),
      defaultValue: entry.name,
      onSubmit: (name) => {
        setPrompt(null)
        if (!name.trim() || name === entry.name) return
        runMutating(t('sftp.renaming'), async () => {
          await api.renameSFTPRemote(activeTab.sessionId, entry.path, siblingPath(entry.path, name.trim()))
          setStatusMessage(t('sftp.renamed'))
        })
      },
    })
  }

  const openDelete = (entry: FileEntry) => {
    if (!activeTab) return
    setPrompt({
      mode: 'confirm',
      title: t('sftp.deleteTitle'),
      message: t('sftp.deleteMsg', { name: entry.name, dirHint: entry.isDir ? t('sftp.dirHint') : '' }),
      confirmLabel: t('common.delete'),
      onSubmit: () => {
        setPrompt(null)
        runMutating(t('sftp.deleting'), async () => {
          await api.deleteSFTPPath(activeTab.sessionId, entry.path)
          setStatusMessage(t('sftp.deleted'))
        })
      },
    })
  }

  const openPaneMenu = (e: React.MouseEvent, entry: FileEntry | null) => {
    e.preventDefault()
    if (entry && !remoteSel.selectedPaths.includes(entry.path)) {
      remoteSel.setSelectedPaths([entry.path])
    }
    setPaneMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const downloadFromMenu = () => {
    if (!paneMenu) return
    setPaneMenu(null)
    handleDownload(remoteSel.selectedPaths)
  }

  const connectedHostIds = new Set(tabs.map((t) => t.hostId))
  const sshHosts = hosts.filter((h) => h.kind === 'ssh')
  const dockerHosts = hosts.filter((h) => h.kind === 'docker')

  return (
    <div className="product-workbench sftp-workbench">
      <div className="product-toolbar sftp-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" {...pressProps(() => setHostModalOpen(true))}>
            <IconPlus size={13} />
            <span>{t('sftp.sshHosts')}</span>
          </button>
          <span className="chrome-vrule" />
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!activeTab || mutating || listLoading.active}
            {...pressProps(() => softRefreshRemote().catch(() => {}), { disabled: !activeTab || mutating || listLoading.active })}
          >
            {t('common.refresh')}
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-toolbar-status">{activeTab ? activeTab.title : t('common.notConnected')}</span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar sftp-sidebar">
          <div className="sftp-side">
            <div className="sftp-side-tabs" role="tablist" aria-label={t('sftp.sideTabs')}>
              {(
                [
                  { id: 'ssh' as const, label: t('sftp.sideTabSSH') },
                  { id: 'docker' as const, label: t('sftp.sideTabDocker') },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === tab.id}
                  className={`sftp-side-tab${sideTab === tab.id ? ' is-active' : ''}`}
                  {...pressProps(() => {
                    setSideTab(tab.id)
                    persistSftpSideTab(tab.id)
                  })}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {sideTab === 'ssh' && (
              <section className="sidebar-section sftp-side-panel">
                <div className="sidebar-header">
                  <span className="sidebar-header-title">{t('sftp.sshHosts')}</span>
                  <button
                    type="button"
                    className="wn-btn wn-btn-icon wn-btn-sm"
                    {...pressProps(() => setHostModalOpen(true))}
                    title={t('common.new')}
                  >
                    <IconPlus size={14} />
                  </button>
                </div>
                <div className="sidebar-body">
                  {sshHosts.length === 0 ? (
                    <EmptyState
                      variant="inline"
                      title={t('sftp.emptyHosts')}
                      actions={[{ label: t('sftp.addHost'), onPress: () => setHostModalOpen(true), primary: true }]}
                    />
                  ) : (
                    <ul className="conn-list is-homogeneous">
                      {sshHosts.map((h) => {
                        const hostLine = `${h.user}@${h.host}:${h.port}`
                        return (
                          <li
                            key={h.id}
                            className={`conn-item ${connectingId === h.id ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''}`}
                            {...pressProps(() => connectHost(h))}
                            onDoubleClick={() => connectHost(h)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setCtxMenu({ x: e.clientX, y: e.clientY, host: h })
                            }}
                          >
                            <div className="conn-meta">
                              <span className="conn-name">{h.name}</span>
                              <span className="conn-host" title={hostLine}>
                                {hostLine}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {sideTab === 'docker' && (
              <section className="sidebar-section sftp-side-panel">
                <div className="sidebar-header">
                  <span className="sidebar-header-title">{t('sftp.dockerHosts')}</span>
                  {dockerHosts.some((h) => h.running === false) && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-ghost wn-btn-sm"
                      title={t('sftp.pruneStopped')}
                      {...pressProps(() => {
                        void (async () => {
                          try {
                            const n = await api.pruneStoppedDockerHosts()
                            await refreshHosts()
                            setStatusMessage(
                              n > 0 ? t('sftp.prunedStopped', { count: n }) : t('sftp.pruneStoppedNone'),
                            )
                          } catch (e) {
                            setStatusMessage((e as Error).message)
                          }
                        })()
                      })}
                    >
                      {t('sftp.pruneStopped')}
                    </button>
                  )}
                </div>
                <div className="sidebar-body">
                  {dockerHosts.length === 0 ? (
                    <EmptyState variant="inline" title={t('sftp.emptyDockerHosts')} />
                  ) : (
                    <ul className="conn-list is-homogeneous">
                      {dockerHosts.map((h) => {
                        const hostLine =
                          h.running === false
                            ? t('sftp.containerStopped')
                            : h.image || h.containerId?.slice(0, 12) || 'container'
                        return (
                          <li
                            key={h.id}
                            className={`conn-item ${connectingId === h.id ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''} ${h.running === false ? 'stopped' : ''}`}
                            {...pressProps(() => connectHost(h))}
                            onDoubleClick={() => connectHost(h)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setCtxMenu({ x: e.clientX, y: e.clientY, host: h })
                            }}
                          >
                            <div className="conn-meta">
                              <span className="conn-name">{h.name}</span>
                              <span className="conn-host" title={hostLine}>
                                {hostLine}
                              </span>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </div>
        </aside>

        <main className="app-main sftp-main">
          {tabs.length > 0 && (
            <div className="editor-chrome sftp-editor-chrome">
              <div className="wn-tabs" ref={tabsRef}>
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    data-tab-id={t.id}
                    className={`wn-tab wn-tab-terminal wn-tab-ssh ${t.id === activeTabId ? 'active' : ''}`}
                    {...pressProps(() => setActiveTabId(t.id))}
                    onContextMenu={(e) => openTabContextMenu(e, t.id, setTabCtxMenu, setActiveTabId)}
                  >
                    <IconServer size={12} />
                    <span className="tab-title">{t.title}</span>
                    <span
                      className="wn-tab-close"
                      {...pressProps(() => closeTab(t.id), { stop: true })}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!activeTab ? (
            <EmptyState
              title={t('sftp.emptyWorkspace')}
              hint={t('sftp.emptyWorkspaceHint')}
              actions={
                sshHosts.length > 0
                  ? [
                      {
                        label: t('sftp.connectHost', { name: sshHosts[0].name }),
                        onPress: () => void connectHost(sshHosts[0]),
                        primary: true,
                      },
                      { label: t('sftp.addHost'), onPress: () => setHostModalOpen(true) },
                    ]
                  : [{ label: t('sftp.addHost'), onPress: () => setHostModalOpen(true), primary: true }]
              }
            />
          ) : (
            <LoadingPane
              loadingKey={activeTab ? `sftp.list.${activeTab.id}` : 'sftp.list._'}
              label={t('common.loading')}
              minHeight={280}
            >
            <div className="product-body sftp-panes sftp-panes-single">
              <FilePane
                path={activeTab.remotePath}
                entries={remoteFiles}
                selectedPaths={remoteSel.selectedPaths}
                flashPaths={flashPaths}
                paneSide="remote"
                bookmarks={remoteBookmarks}
                wailsDropTarget
                onNavigate={(p) => updateActiveTab({ remotePath: p })}
                onRowClick={remoteSel.handleRowClick}
                onTogglePath={remoteSel.togglePath}
                onSelectAll={remoteSel.selectAll}
                onOpenDir={(entry) => updateActiveTab({ remotePath: entry.path })}
                onOpenFile={(entry) => handleOpenFile(entry)}
                onGoUp={() => updateActiveTab({ remotePath: parentRemotePath(activeTab.remotePath) })}
                onContextMenu={(e, entry) => openPaneMenu(e, entry)}
                onAddBookmark={() => void addBookmark()}
                onBookmarkNavigate={(p) => updateActiveTab({ remotePath: p })}
                onDeleteBookmark={deleteBookmark}
                onRefresh={() => {
                  void softRefreshRemote().catch((e) => setStatusMessage((e as Error).message))
                }}
                refreshTitle={t('sftp.refreshRemote')}
                onMkdir={openMkdir}
                onUpload={handleUpload}
                onUploadFolder={handleUploadFolder}
                onDownloadSelected={() => handleDownload()}
                downloadDisabled={remoteSel.selectedPaths.length === 0}
                onRename={openRename}
                onDelete={openDelete}
              />
            </div>
            </LoadingPane>
          )}
        </main>
      </div>

      <SftpTextEditor
        open={!!textEditor}
        path={textEditor?.path || ''}
        name={textEditor?.name || ''}
        content={textEditor?.content || ''}
        revision={textEditor?.revision || 0}
        saving={textSaving}
        onChange={(content) => setTextEditor((prev) => (prev ? { ...prev, content } : prev))}
        onSave={saveTextEditor}
        onReload={reloadTextEditor}
        onClose={() => setTextEditor(null)}
      />

      <SftpImagePreview
        open={!!imagePreview}
        path={imagePreview?.path || ''}
        name={imagePreview?.name || ''}
        src={imagePreview?.src || ''}
        size={imagePreview?.size || 0}
        onDownload={
          imagePreview
            ? () => {
                const p = imagePreview.path
                setImagePreview(null)
                handleDownload([p])
              }
            : undefined
        }
        onClose={() => setImagePreview(null)}
      />

      <SftpTransferModal
        open={transferOpen}
        mode={transferMode}
        remotePath={activeTab?.remotePath || '/'}
        localDir={downloadLocalDir || activeTab?.localPath || ''}
        staged={stagedTransfers}
        tasks={transferQueue.tasks}
        onAddFiles={handleUpload}
        onAddFolder={handleUploadFolder}
        onChangeDownloadDir={handleChangeDownloadDir}
        onRemoveStaged={(id) => setStagedTransfers((prev) => prev.filter((s) => s.id !== id))}
        onClearStaged={() => {
          setStagedTransfers([])
          transferQueue.clearFinished()
        }}
        onStart={startStagedTransfers}
        onCancelTask={transferQueue.cancelTask}
        onClose={() => setTransferOpen(false)}
      />

      {!transferOpen && transferQueue.activeCount > 0 && (
        <button
          type="button"
          className="sftp-transfer-fab"
          {...pressProps(() => {
            const hasDl = transferQueue.tasks.some((x) => x.kind === 'download' && (x.state === 'queued' || x.state === 'running'))
            setTransferMode(hasDl ? 'download' : 'upload')
            setTransferOpen(true)
          })}
        >
          {t('sftp.transferFab', { count: transferQueue.activeCount })}
        </button>
      )}

      <SSHHostModal open={hostModalOpen} initial={editingHost} onClose={() => setHostModalOpen(false)} onSaved={refreshHosts} />

      {tabCtxMenu && (
        <TabContextMenu
          menu={tabCtxMenu}
          disableCloseOthers={tabs.length <= 1}
          onDismiss={() => setTabCtxMenu(null)}
          onClose={() => void closeTab(tabCtxMenu.tabId)}
          onCloseOthers={() => void closeOtherTabs(tabCtxMenu.tabId)}
          onCloseAll={() => void closeAllTabs()}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          key={`host-${ctxMenu.host.id}-${ctxMenu.x}-${ctxMenu.y}`}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const host = ctxMenu.host
              setCtxMenu(null)
              if (host.kind === 'docker') {
                openAgentDraft({
                  mentions: [mentionDockerHost(host)],
                })
                return
              }
              const ssh = shellHostAsSSH(host)
              if (!ssh) return
              openAgentDraft({
                mentions: [mentionSSH(ssh)],
              })
            })}
          >
            {t('agent.sendToAgent')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              openNotebook({ hostId: ctxMenu.host.id }, 'sftp')
            })}
          >
            {t('sftp.ctxNotebook')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              openTerminal({ hostId: ctxMenu.host.id }, 'sftp')
            })}
          >
            {t('sftp.ctxTerminal')}
          </button>
          {ctxMenu.host.kind === 'docker' && ctxMenu.host.contextId && ctxMenu.host.containerId && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                setCtxMenu(null)
                openLogs(
                  {
                    sourceType: 'docker',
                    name: host.containerName || host.name,
                    dockerContextId: host.contextId,
                    containerId: host.containerId,
                    fetch: true,
                  },
                  'sftp',
                )
              })}
            >
              {t('sftp.ctxLogs')}
            </button>
          )}
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                setCtxMenu(null)
                openLogs(
                  {
                    sourceType: 'ssh_file',
                    name: host.name,
                    sshHostId: host.id,
                    fetch: false,
                  },
                  'sftp',
                )
              })}
            >
              {t('sftp.ctxLogs')}
            </button>
          )}
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                setCtxMenu(null)
                openSSHForward({ hostId: ctxMenu.host.id, openNew: true }, 'sftp')
              })}
            >
              {t('sftp.ctxForward')}
            </button>
          )}
          {ctxMenu.host.kind === 'ssh' ? (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const ssh = shellHostAsSSH(ctxMenu.host)
                setCtxMenu(null)
                if (ssh) {
                  setEditingHost(ssh)
                  setHostModalOpen(true)
                }
              })}
            >
              {t('common.edit')}
            </button>
          ) : (
            <button
              type="button"
              className="wn-context-item danger"
              {...pressProps(() => {
                const host = ctxMenu.host
                setCtxMenu(null)
                void (async () => {
                  try {
                    await api.removeDockerHost(host.id)
                    await refreshHosts()
                    setStatusMessage(t('sftp.removedDockerHost', { name: host.name }))
                  } catch (e) {
                    setStatusMessage((e as Error).message)
                  }
                })()
              })}
            >
              {t('sftp.removeDockerHost')}
            </button>
          )}
        </ContextMenu>
      )}

      {paneMenu && (
        <ContextMenu
          key={`pane-${paneMenu.x}-${paneMenu.y}`}
          x={paneMenu.x}
          y={paneMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          {remoteSel.selectedPaths.length > 0 && (
            <button type="button" className="wn-context-item" {...pressProps(downloadFromMenu)}>
              {remoteSel.selectedPaths.length > 1
                ? t('sftp.downloadLocalN', { count: remoteSel.selectedPaths.length })
                : t('sftp.downloadLocal')}
            </button>
          )}
          {paneMenu.entry && !paneMenu.entry.isDir && isProbablyImageFile(paneMenu.entry.name) && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const entry = paneMenu.entry!
                setPaneMenu(null)
                openImagePreview(entry)
              })}
            >
              {t('sftp.imagePreview')}
            </button>
          )}
          {paneMenu.entry && !paneMenu.entry.isDir && isProbablyTextFile(paneMenu.entry.name) && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const entry = paneMenu.entry!
                setPaneMenu(null)
                openTextEditor(entry)
              })}
            >
              {t('common.edit')}
            </button>
          )}
          {paneMenu.entry && !paneMenu.entry.isDir && activeTab && (() => {
            const host = hosts.find((h) => h.id === activeTab.hostId)
            if (host?.kind !== 'ssh') return null
            const entry = paneMenu.entry!
            return (
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setPaneMenu(null)
                  openLogs(
                    {
                      sourceType: 'ssh_file',
                      name: entry.name,
                      path: entry.path,
                      sshHostId: host.id,
                      fetch: true,
                    },
                    'sftp',
                  )
                })}
              >
                {t('sftp.openInLogs')}
              </button>
            )
          })()}
          {paneMenu.entry && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const entry = paneMenu.entry!
                setPaneMenu(null)
                void navigator.clipboard.writeText(entry.path).then(
                  () => setStatusMessage(t('sftp.pathCopied', { path: entry.path })),
                  () => setStatusMessage(t('sftp.pathCopyFailed')),
                )
              })}
            >
              {t('sftp.copyPath')}
            </button>
          )}
          {paneMenu.entry && activeTab && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const entry = paneMenu.entry!
                const hostId = activeTab.hostId
                const dir = entry.isDir ? entry.path : parentRemotePath(entry.path)
                setPaneMenu(null)
                openTerminal({ hostId, initialCommand: `cd ${shellSingleQuote(dir)}` }, 'sftp')
              })}
            >
              {t('sftp.openInTerminal')}
            </button>
          )}
          <button type="button" className="wn-context-item" {...pressProps(() => { setPaneMenu(null); handleUpload() })}>
            {t('sftp.upload')}
          </button>
          <button type="button" className="wn-context-item" {...pressProps(() => { setPaneMenu(null); handleUploadFolder() })}>
            {t('sftp.uploadFolder')}
          </button>
          <div className="wn-context-sep" />
          <button type="button" className="wn-context-item" {...pressProps(() => { setPaneMenu(null); openMkdir() })}>
            {t('sftp.newFolder')}
          </button>
          {paneMenu.entry && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setPaneMenu(null)
                  openRename(paneMenu.entry!)
                })}
              >
                {t('sftp.rename')}
              </button>
              <button
                type="button"
                className="wn-context-item danger"
                {...pressProps(() => {
                  setPaneMenu(null)
                  openDelete(paneMenu.entry!)
                })}
              >
                {t('common.delete')}
              </button>
            </>
          )}
        </ContextMenu>
      )}

      {prompt && (
        <SftpPrompt
          open
          mode={prompt.mode}
          title={prompt.title}
          message={prompt.message}
          defaultValue={prompt.defaultValue}
          confirmLabel={prompt.confirmLabel}
          onConfirm={prompt.onSubmit}
          onCancel={() => setPrompt(null)}
        />
      )}
      {trustDialog}
      {conflictResolver.dialog}
    </div>
  )
}

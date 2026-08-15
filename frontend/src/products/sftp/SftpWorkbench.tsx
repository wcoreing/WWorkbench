import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, SftpBookmark, ShellHost, SSHHost } from '../../api/types'
import { shellHostAsSSH } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { IconDocker, IconPlus, IconServer } from '../../components/Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildSftpSurface, briefList } from '../../stores/agentSurface'
import { openAgentDraft, mentionSSH, mentionDockerHost } from '../../features/agent/openAgentDraft'
import { openProductLink, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { restoreSftpTab } from '../../features/sftp/restoreSftpWorkspace'
import { pressProps, useDismissOverlays } from '../../components/compat'
import {
  loadSftpWorkspace,
  scheduleSftpWorkspacePersist,
  toSftpWorkspaceSnapshot,
} from '../../stores/sftpWorkspacePersist'
import { SSHHostModal } from '../../features/terminal/SSHHostModal'
import { useSSHTrustConfirm } from '../../features/terminal/useSSHTrustConfirm'
import { FilePane } from '../../features/sftp/FilePane'
import { selectionHint } from '../../features/sftp/fileSelectionHint'
import { SftpPrompt, type SftpPromptMode } from '../../features/sftp/SftpPrompt'
import { SftpBottomBar } from '../../features/sftp/SftpBottomBar'
import { SftpTransferRail } from '../../features/sftp/SftpTransferRail'
import { useFileSelection } from '../../features/sftp/useFileSelection'
import { useSftpFileDrop } from '../../features/sftp/useSftpFileDrop'
import { useScrollActiveTabIntoView } from '../../hooks/useScrollActiveTabIntoView'
import { useSftpTransferQueue } from '../../features/sftp/useSftpTransferQueue'
import { useSftpConflictResolver } from '../../features/sftp/useSftpConflictResolver'
import { filterPathsWithConflict } from '../../features/sftp/transferConflict'
import type { DragPayload } from '../../features/sftp/FilePane'
import { joinLocalPath, joinRemotePath, parentLocalPath, parentRemotePath, siblingPath } from '../../features/sftp/sftpUtils'

interface SftpTab {
  id: string
  sessionId: string
  hostId: string
  title: string
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

type PaneSide = 'local' | 'remote'

/** SFTP 产品线工作区 */
export function SftpWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [hosts, setHosts] = useState<ShellHost[]>([])
  const [tabs, setTabs] = useState<SftpTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [localFiles, setLocalFiles] = useState<FileEntry[]>([])
  const [remoteFiles, setRemoteFiles] = useState<FileEntry[]>([])
  const localSel = useFileSelection(localFiles)
  const remoteSel = useFileSelection(remoteFiles)
  const [localBookmarks, setLocalBookmarks] = useState<SftpBookmark[]>([])
  const [remoteBookmarks, setRemoteBookmarks] = useState<SftpBookmark[]>([])
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [hostModalOpen, setHostModalOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; host: ShellHost } | null>(null)
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; side: PaneSide; entry: FileEntry | null } | null>(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const workspaceRestored = useRef(false)

  useDismissOverlays(() => {
    setCtxMenu(null)
    setPaneMenu(null)
    setTabCtxMenu(null)
  })

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
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
        localPath: activeTab?.localPath,
        remotePath: activeTab?.remotePath,
        localSelected: localSel.selectedPaths,
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
    localSel.selectedPaths,
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
      const local = await api.listSFTPBookmarks('local', '')
      setLocalBookmarks(local)
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

  const loadLocal = useCallback(async (path: string) => {
    const res = await api.listLocalDir(path)
    setLocalFiles(res.entries)
    return res.path
  }, [])

  const loadRemote = useCallback(async (sessionId: string, path: string) => {
    return api.listSFTPDir(sessionId, path)
  }, [])

  const refreshLocal = useCallback(async () => {
    if (!activeTab) return
    const localPath = await loadLocal(activeTab.localPath)
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, localPath } : t)))
    localSel.clearSelection()
  }, [activeTab, loadLocal, localSel.clearSelection])

  const refreshRemote = useCallback(async () => {
    if (!activeTab) return
    const remoteList = await loadRemote(activeTab.sessionId, activeTab.remotePath)
    setRemoteFiles(remoteList)
    remoteSel.clearSelection()
  }, [activeTab, loadRemote, remoteSel.clearSelection])

  const refreshListings = useCallback(async () => {
    if (!activeTab) return
    const [localPath, remoteList] = await Promise.all([
      loadLocal(activeTab.localPath),
      loadRemote(activeTab.sessionId, activeTab.remotePath),
    ])
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, localPath } : t)))
    setRemoteFiles(remoteList)
  }, [activeTab, loadLocal, loadRemote])

  const refreshActive = useCallback(async () => {
    await refreshListings()
    localSel.clearSelection()
    remoteSel.clearSelection()
  }, [refreshListings, localSel.clearSelection, remoteSel.clearSelection])

  const conflictResolver = useSftpConflictResolver()

  const transferQueue = useSftpTransferQueue(() => {
    refreshListings().catch((e) => setStatusMessage((e as Error).message))
  })

  useEffect(() => {
    if (!activeTab) {
      setLocalFiles([])
      setRemoteFiles([])
      return
    }
    refreshActive().catch((e) => setStatusMessage((e as Error).message))
    loadBookmarks()
  }, [activeTab?.id, activeTab?.localPath, activeTab?.remotePath])

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
      await refreshActive()
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
    [activeTab, conflictResolver.ask, transferQueue.enqueueUpload, setStatusMessage]
  )

  const requestDownload = useCallback(
    async (paths: string[]) => {
      if (!activeTab || paths.length === 0) return
      const accepted = await filterPathsWithConflict(
        'download',
        activeTab.sessionId,
        paths,
        activeTab.localPath,
        conflictResolver.ask
      )
      if (!accepted.length) return
      transferQueue.enqueueDownload(activeTab.sessionId, accepted, activeTab.localPath)
      setStatusMessage(t('sftp.queuedDownload', { count: accepted.length }))
    },
    [activeTab, conflictResolver.ask, transferQueue.enqueueDownload, setStatusMessage]
  )

  const uploadPaths = (paths: string[]) => {
    requestUpload(paths).catch((e) => setStatusMessage((e as Error).message))
  }

  const downloadPaths = (paths: string[]) => {
    requestDownload(paths).catch((e) => setStatusMessage((e as Error).message))
  }

  const handleUpload = () => {
    const paths = localSel.selectedPaths
    if (!paths.length) {
      setStatusMessage(t('sftp.pickUpload'))
      return
    }
    uploadPaths(paths)
  }

  const handleDownload = () => {
    const paths = remoteSel.selectedPaths
    if (!paths.length) {
      setStatusMessage(t('sftp.pickDownload'))
      return
    }
    downloadPaths(paths)
  }

  const handleOsFileDrop = useCallback(
    (paths: string[]) => uploadPaths(paths),
    [uploadPaths]
  )

  useSftpFileDrop(!!activeTab, handleOsFileDrop)

  const addBookmark = async (side: PaneSide) => {
    if (!activeTab) return
    try {
      await api.saveSFTPBookmark({
        id: '',
        side,
        hostId: side === 'remote' ? activeTab.hostId : '',
        name: '',
        path: side === 'local' ? activeTab.localPath : activeTab.remotePath,
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

  const openMkdir = (side: PaneSide) => {
    if (!activeTab) return
    setPrompt({
      mode: 'mkdir',
      title: side === 'local' ? t('sftp.newLocalFolder') : t('sftp.newRemoteFolder'),
      onSubmit: (name) => {
        setPrompt(null)
        if (!name.trim()) return
        runMutating(t('sftp.creating'), async () => {
          if (side === 'local') {
            await api.mkdirLocalPath(joinLocalPath(activeTab.localPath, name.trim()))
          } else {
            await api.mkdirSFTPRemote(activeTab.sessionId, joinRemotePath(activeTab.remotePath, name.trim()))
          }
          setStatusMessage(t('sftp.folderCreated'))
        })
      },
    })
  }

  const openRename = (side: PaneSide, entry: FileEntry) => {
    if (!activeTab) return
    setPrompt({
      mode: 'rename',
      title: t('sftp.rename'),
      defaultValue: entry.name,
      onSubmit: (name) => {
        setPrompt(null)
        if (!name.trim() || name === entry.name) return
        runMutating(t('sftp.renaming'), async () => {
          if (side === 'local') {
            await api.renameLocalPath(entry.path, siblingPath(entry.path, name.trim()))
          } else {
            await api.renameSFTPRemote(activeTab.sessionId, entry.path, siblingPath(entry.path, name.trim()))
          }
          setStatusMessage(t('sftp.renamed'))
        })
      },
    })
  }

  const openDelete = (side: PaneSide, entry: FileEntry) => {
    if (!activeTab) return
    setPrompt({
      mode: 'confirm',
      title: t('sftp.deleteTitle'),
      message: t('sftp.deleteMsg', { name: entry.name, dirHint: entry.isDir ? t('sftp.dirHint') : '' }),
      confirmLabel: t('common.delete'),
      onSubmit: () => {
        setPrompt(null)
        runMutating(t('sftp.deleting'), async () => {
          if (side === 'local') {
            await api.deleteLocalPath(entry.path)
          } else {
            await api.deleteSFTPPath(activeTab.sessionId, entry.path)
          }
          setStatusMessage(t('sftp.deleted'))
        })
      },
    })
  }

  const openPaneMenu = (e: React.MouseEvent, side: PaneSide, entry: FileEntry | null) => {
    e.preventDefault()
    if (entry) {
      const sel = side === 'local' ? localSel : remoteSel
      if (!sel.selectedPaths.includes(entry.path)) {
        sel.setSelectedPaths([entry.path])
      }
    }
    setPaneMenu({ x: e.clientX, y: e.clientY, side, entry })
  }

  const uploadFromMenu = () => {
    if (!paneMenu) return
    setPaneMenu(null)
    uploadPaths(localSel.selectedPaths)
  }

  const downloadFromMenu = () => {
    if (!paneMenu) return
    setPaneMenu(null)
    downloadPaths(remoteSel.selectedPaths)
  }

  const localNames = localSel.selectedEntries.map((e) => e.name)
  const remoteNames = remoteSel.selectedEntries.map((e) => e.name)
  const connectedHostIds = new Set(tabs.map((t) => t.hostId))
  const sshHosts = hosts.filter((h) => h.kind === 'ssh')
  const dockerHosts = hosts.filter((h) => h.kind === 'docker')

  return (
    <div className="product-workbench sftp-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" {...pressProps(() => setHostModalOpen(true))}>
            <IconPlus size={13} />
            <span>{t('sftp.sshHosts')}</span>
          </button>
          <span className="chrome-vrule" />
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            disabled={!activeTab || mutating}
            {...pressProps(() => refreshActive().catch(() => {}), { disabled: !activeTab || mutating })}
          >
            {t('common.refresh')}
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-toolbar-status">{activeTab ? activeTab.title : t('common.notConnected')}</span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar terminal-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('sftp.sshHosts')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" {...pressProps(() => setHostModalOpen(true))}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {sshHosts.length === 0 ? (
                <div className="empty-hint">{t('sftp.emptyHosts')}</div>
              ) : (
                <ul className="conn-list">
                  {sshHosts.map((h) => (
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
                      <IconServer size={14} className="mock-icon" />
                      <div className="conn-meta">
                        <span className="conn-name">{h.name}</span>
                        <span className="conn-host">
                          {h.user}@{h.host}:{h.port}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {dockerHosts.length > 0 && (
            <section className="sidebar-section">
              <div className="sidebar-header">
                <span>{t('sftp.dockerHosts')}</span>
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
                            n > 0 ? t('sftp.prunedStopped', { count: n }) : t('sftp.pruneStoppedNone')
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
                <ul className="conn-list">
                  {dockerHosts.map((h) => (
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
                      <IconDocker size={14} className="mock-icon" />
                      <div className="conn-meta">
                        <span className="conn-name">{h.name}</span>
                        <span className="conn-host">
                          {h.running === false
                            ? t('sftp.containerStopped')
                            : h.image || h.containerId?.slice(0, 12) || 'container'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </aside>

        <main className="app-main sftp-main">
          {tabs.length > 0 && (
            <div className="editor-chrome">
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
            <div className="pane-empty">
              <span>{t('sftp.emptyWorkspace')}</span>
            </div>
          ) : (
            <div className="product-body sftp-panes">
              <FilePane
                label={t('sftp.local')}
                path={activeTab.localPath}
                entries={localFiles}
                selectedPaths={localSel.selectedPaths}
                paneSide="local"
                bookmarks={localBookmarks}
                allowDrag
                acceptDropFrom={['remote']}
                onNavigate={(p) => updateActiveTab({ localPath: p })}
                onRowClick={localSel.handleRowClick}
                onOpenDir={(entry) => updateActiveTab({ localPath: entry.path })}
                onOpenFile={(entry) => uploadPaths([entry.path])}
                onGoUp={() => updateActiveTab({ localPath: parentLocalPath(activeTab.localPath) })}
                onContextMenu={(e, entry) => openPaneMenu(e, 'local', entry)}
                onAddBookmark={() => addBookmark('local')}
                onBookmarkNavigate={(p) => updateActiveTab({ localPath: p })}
                onDeleteBookmark={deleteBookmark}
                onRefresh={() => {
                  void refreshLocal().catch((e) => setStatusMessage((e as Error).message))
                }}
                refreshTitle={t('sftp.refreshLocal')}
                onInternalDrop={(payload: DragPayload) => {
                  if (payload.side === 'remote') downloadPaths(payload.paths)
                }}
              />
              <SftpTransferRail
                canUpload={localSel.selectedPaths.length > 0}
                canDownload={remoteSel.selectedPaths.length > 0}
                transferring={transferQueue.activeCount > 0}
                localHint={selectionHint(localNames)}
                remoteHint={selectionHint(remoteNames)}
                onUpload={handleUpload}
                onDownload={handleDownload}
              />
              <FilePane
                label={t('sftp.remote')}
                path={activeTab.remotePath}
                entries={remoteFiles}
                selectedPaths={remoteSel.selectedPaths}
                paneSide="remote"
                bookmarks={remoteBookmarks}
                allowDrag
                acceptDropFrom={['local']}
                wailsDropTarget
                onNavigate={(p) => updateActiveTab({ remotePath: p })}
                onRowClick={remoteSel.handleRowClick}
                onOpenDir={(entry) => updateActiveTab({ remotePath: entry.path })}
                onOpenFile={(entry) => downloadPaths([entry.path])}
                onGoUp={() => updateActiveTab({ remotePath: parentRemotePath(activeTab.remotePath) })}
                onContextMenu={(e, entry) => openPaneMenu(e, 'remote', entry)}
                onAddBookmark={() => addBookmark('remote')}
                onBookmarkNavigate={(p) => updateActiveTab({ remotePath: p })}
                onDeleteBookmark={deleteBookmark}
                onRefresh={() => {
                  void refreshRemote().catch((e) => setStatusMessage((e as Error).message))
                }}
                refreshTitle={t('sftp.refreshRemote')}
                onInternalDrop={(payload: DragPayload) => {
                  if (payload.side === 'local') uploadPaths(payload.paths)
                }}
              />
            </div>
          )}
        </main>
      </div>

      <SftpBottomBar
        tasks={transferQueue.tasks}
        onCancel={transferQueue.cancelTask}
        onClearFinished={transferQueue.clearFinished}
      />

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
                  message: t('agent.draftContainer'),
                })
                return
              }
              const ssh = shellHostAsSSH(host)
              if (!ssh) return
              openAgentDraft({
                mentions: [mentionSSH(ssh)],
                message: t('agent.draftSSH'),
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
              openProductLink({ action: 'notebook', hostId: ctxMenu.host.id })
            })}
          >
            {t('sftp.ctxNotebook')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              openProductLink({ action: 'terminal', hostId: ctxMenu.host.id })
            })}
          >
            {t('sftp.ctxTerminal')}
          </button>
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
          key={`pane-${paneMenu.side}-${paneMenu.x}-${paneMenu.y}`}
          x={paneMenu.x}
          y={paneMenu.y}
          onClick={(e) => e.stopPropagation()}
        >
          {paneMenu.side === 'local' && localSel.selectedPaths.length > 0 && (
            <button type="button" className="wn-context-item" {...pressProps(uploadFromMenu)}>
              {localSel.selectedPaths.length > 1
                ? t('sftp.uploadRemoteN', { count: localSel.selectedPaths.length })
                : t('sftp.uploadRemote')}
            </button>
          )}
          {paneMenu.side === 'remote' && remoteSel.selectedPaths.length > 0 && (
            <button type="button" className="wn-context-item" {...pressProps(downloadFromMenu)}>
              {remoteSel.selectedPaths.length > 1
                ? t('sftp.downloadLocalN', { count: remoteSel.selectedPaths.length })
                : t('sftp.downloadLocal')}
            </button>
          )}
          {(paneMenu.side === 'local' && localSel.selectedPaths.length > 0) ||
          (paneMenu.side === 'remote' && remoteSel.selectedPaths.length > 0) ? (
            <div className="wn-context-sep" />
          ) : null}
          <button type="button" className="wn-context-item" {...pressProps(() => { setPaneMenu(null); openMkdir(paneMenu.side) })}>
            {t('sftp.newFolder')}
          </button>
          {paneMenu.entry && (
            <>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  setPaneMenu(null)
                  openRename(paneMenu.side, paneMenu.entry!)
                })}
              >
                {t('sftp.rename')}
              </button>
              <button
                type="button"
                className="wn-context-item danger"
                {...pressProps(() => {
                  setPaneMenu(null)
                  openDelete(paneMenu.side, paneMenu.entry!)
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

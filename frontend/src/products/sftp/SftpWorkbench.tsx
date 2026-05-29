import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, SftpBookmark, SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { IconPlus, IconServer } from '../../components/Icons'
import { useAppStore } from '../../stores/appStore'
import { restoreSftpTab } from '../../features/sftp/restoreSftpWorkspace'
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
import { SftpTransferPanel } from '../../features/sftp/SftpTransferPanel'
import { SftpTransferRail } from '../../features/sftp/SftpTransferRail'
import { useFileSelection } from '../../features/sftp/useFileSelection'
import { useSftpFileDrop } from '../../features/sftp/useSftpFileDrop'
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
  const { setStatusMessage, productLink, setProductLink, setActiveProduct } = useAppStore()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [hosts, setHosts] = useState<SSHHost[]>([])
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
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; host: SSHHost } | null>(null)
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; side: PaneSide; entry: FileEntry | null } | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const workspaceRestored = useRef(false)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const refreshHosts = useCallback(async () => {
    try {
      setHosts(await api.listSSHHosts())
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
    if (workspaceRestored.current) {
      refreshHosts()
      loadBookmarks()
      return
    }
    workspaceRestored.current = true
    void (async () => {
      try {
        const hostList = await api.listSSHHosts()
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
        setStatusMessage(`已恢复 ${restored.length} 个 SFTP 会话`)
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
    if (!ctxMenu && !paneMenu) return
    const close = () => {
      setCtxMenu(null)
      setPaneMenu(null)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu, paneMenu])

  const loadLocal = useCallback(async (path: string) => {
    const res = await api.listLocalDir(path)
    setLocalFiles(res.entries)
    return res.path
  }, [])

  const loadRemote = useCallback(async (sessionId: string, path: string) => {
    return api.listSFTPDir(sessionId, path)
  }, [])

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
    refreshListings().catch(() => {})
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

  const connectHost = async (host: SSHHost) => {
    if (connectingId) return
    setConnectingId(host.id)
    setStatusMessage(`正在连接 ${host.name}…`)
    try {
      const info = await withSSHHostTrust(host.host, host.port, () => api.openSFTPSession(host.id), confirmTrust)
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
      setStatusMessage(`已连接 ${tab.title}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setConnectingId(null)
    }
  }

  useEffect(() => {
    if (!productLink || productLink.action !== 'sftp') return
    const { hostId } = productLink
    if (!hostId) return
    setProductLink(null)
    void (async () => {
      try {
        let host = hosts.find((h) => h.id === hostId)
        if (!host) {
          host = await api.getSSHHost(hostId)
          setHosts((prev) => (prev.some((h) => h.id === hostId) ? prev : [...prev, host!]))
        }
        await connectHost(host)
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }, [productLink])

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
      setStatusMessage(`已加入上传队列（${accepted.length} 项）`)
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
      setStatusMessage(`已加入下载队列（${accepted.length} 项）`)
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
      setStatusMessage('请在左侧选择要上传的文件或文件夹')
      return
    }
    uploadPaths(paths)
  }

  const handleDownload = () => {
    const paths = remoteSel.selectedPaths
    if (!paths.length) {
      setStatusMessage('请在右侧选择要下载的文件或文件夹')
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
      setStatusMessage('已添加书签')
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
      title: side === 'local' ? '新建本地文件夹' : '新建远程文件夹',
      onSubmit: (name) => {
        setPrompt(null)
        if (!name.trim()) return
        runMutating('正在创建…', async () => {
          if (side === 'local') {
            await api.mkdirLocalPath(joinLocalPath(activeTab.localPath, name.trim()))
          } else {
            await api.mkdirSFTPRemote(activeTab.sessionId, joinRemotePath(activeTab.remotePath, name.trim()))
          }
          setStatusMessage('已创建文件夹')
        })
      },
    })
  }

  const openRename = (side: PaneSide, entry: FileEntry) => {
    if (!activeTab) return
    setPrompt({
      mode: 'rename',
      title: '重命名',
      defaultValue: entry.name,
      onSubmit: (name) => {
        setPrompt(null)
        if (!name.trim() || name === entry.name) return
        runMutating('正在重命名…', async () => {
          if (side === 'local') {
            await api.renameLocalPath(entry.path, siblingPath(entry.path, name.trim()))
          } else {
            await api.renameSFTPRemote(activeTab.sessionId, entry.path, siblingPath(entry.path, name.trim()))
          }
          setStatusMessage('已重命名')
        })
      },
    })
  }

  const openDelete = (side: PaneSide, entry: FileEntry) => {
    if (!activeTab) return
    setPrompt({
      mode: 'confirm',
      title: '确认删除',
      message: `确定删除「${entry.name}」？${entry.isDir ? '（含子目录）' : ''}`,
      confirmLabel: '删除',
      onSubmit: () => {
        setPrompt(null)
        runMutating('正在删除…', async () => {
          if (side === 'local') {
            await api.deleteLocalPath(entry.path)
          } else {
            await api.deleteSFTPPath(activeTab.sessionId, entry.path)
          }
          setStatusMessage('已删除')
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

  return (
    <div className="product-workbench sftp-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" onClick={() => setHostModalOpen(true)}>
            <IconPlus size={13} />
            <span>SSH 主机</span>
          </button>
          <span className="chrome-vrule" />
          <button type="button" className="wn-btn wn-btn-chrome" disabled={!activeTab || mutating} onClick={() => refreshActive().catch(() => {})}>
            刷新
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-toolbar-status">{activeTab ? activeTab.title : '未连接'}</span>
      </div>

      <SftpTransferPanel
        tasks={transferQueue.tasks}
        onCancel={transferQueue.cancelTask}
        onClearFinished={transferQueue.clearFinished}
      />

      <div className="product-body">
        <aside className="app-sidebar terminal-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>SSH 主机</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => setHostModalOpen(true)}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {hosts.length === 0 ? (
                <div className="empty-hint">添加 SSH 主机后连接 SFTP</div>
              ) : (
                <ul className="conn-list">
                  {hosts.map((h) => (
                    <li
                      key={h.id}
                      className={`conn-item ${connectingId === h.id ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''}`}
                      onClick={() => connectHost(h)}
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
        </aside>

        <main className="app-main sftp-main">
          {tabs.length > 0 && (
            <div className="editor-chrome">
              <div className="wn-tabs">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`wn-tab wn-tab-terminal wn-tab-ssh ${t.id === activeTabId ? 'active' : ''}`}
                    onClick={() => setActiveTabId(t.id)}
                  >
                    <IconServer size={12} />
                    <span className="tab-title">{t.title}</span>
                    <span
                      className="wn-tab-close"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(t.id)
                      }}
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
              <span>选择 SSH 主机连接 SFTP</span>
            </div>
          ) : (
            <div className="product-body sftp-panes">
              <FilePane
                label="本地"
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
                label="远程"
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
                onInternalDrop={(payload: DragPayload) => {
                  if (payload.side === 'local') uploadPaths(payload.paths)
                }}
              />
            </div>
          )}
        </main>
      </div>

      <SSHHostModal open={hostModalOpen} initial={editingHost} onClose={() => setHostModalOpen(false)} onSaved={refreshHosts} />

      {ctxMenu && (
        <div className="wn-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              setActiveProduct('terminal')
              setProductLink({ action: 'terminal', hostId: ctxMenu.host.id })
            }}
          >
            打开终端
          </button>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              setEditingHost(ctxMenu.host)
              setHostModalOpen(true)
            }}
          >
            编辑
          </button>
        </div>
      )}

      {paneMenu && (
        <div className="wn-context-menu" style={{ left: paneMenu.x, top: paneMenu.y }} onClick={(e) => e.stopPropagation()}>
          {paneMenu.side === 'local' && localSel.selectedPaths.length > 0 && (
            <button type="button" className="wn-context-item" onClick={uploadFromMenu}>
              上传到远程{localSel.selectedPaths.length > 1 ? `（${localSel.selectedPaths.length} 项）` : ''}
            </button>
          )}
          {paneMenu.side === 'remote' && remoteSel.selectedPaths.length > 0 && (
            <button type="button" className="wn-context-item" onClick={downloadFromMenu}>
              下载到本地{remoteSel.selectedPaths.length > 1 ? `（${remoteSel.selectedPaths.length} 项）` : ''}
            </button>
          )}
          {(paneMenu.side === 'local' && localSel.selectedPaths.length > 0) ||
          (paneMenu.side === 'remote' && remoteSel.selectedPaths.length > 0) ? (
            <div className="wn-context-sep" />
          ) : null}
          <button type="button" className="wn-context-item" onClick={() => { setPaneMenu(null); openMkdir(paneMenu.side) }}>
            新建文件夹
          </button>
          {paneMenu.entry && (
            <>
              <button
                type="button"
                className="wn-context-item"
                onClick={() => {
                  setPaneMenu(null)
                  openRename(paneMenu.side, paneMenu.entry!)
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="wn-context-item danger"
                onClick={() => {
                  setPaneMenu(null)
                  openDelete(paneMenu.side, paneMenu.entry!)
                }}
              >
                删除
              </button>
            </>
          )}
        </div>
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

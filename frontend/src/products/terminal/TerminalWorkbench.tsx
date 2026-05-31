import { useCallback, useEffect, useRef, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconLaptop, IconPlus, IconServer, IconTerminal } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { openProductLink, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadBool, payloadStr } from '../../workbench/commandPayload'
import {
  loadTerminalWorkspace,
  scheduleTerminalWorkspacePersist,
  toTerminalWorkspaceSnapshot,
} from '../../stores/terminalWorkspacePersist'
import { restoreTerminalTab } from '../../features/terminal/restoreTerminalWorkspace'
import { SSHHostModal } from '../../features/terminal/SSHHostModal'
import { useSSHTrustConfirm } from '../../features/terminal/useSSHTrustConfirm'
import { SSHForwardPanel } from '../../features/terminal/SSHForwardPanel'
import { TerminalSplitView } from '../../features/terminal/TerminalSplitView'
import { terminalBackground } from '../../features/terminal/TerminalPane'
import {
  closePane,
  collectSessionIds,
  countLeaves,
  createLeaf,
  findPane,
  firstLeafId,
  splitPane,
  type PaneLayout,
} from '../../features/terminal/terminalLayout'

/** firstSessionId 取分屏布局中第一个会话 ID。 */
function firstSessionId(layout: PaneLayout): string | null {
  const ids = collectSessionIds(layout)
  return ids[0] ?? null
}

interface TerminalTab {
  id: string
  hostId: string
  kind: 'local' | 'ssh'
  title: string
  layout: PaneLayout
  activePaneId: string
}

const MAX_PANES = 4

/** 终端产品线工作区 */
export function TerminalWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, terminalOpacity, setTerminalOpacity, setActiveProduct, setAgentFocusSSH } =
    useAppStore()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [hosts, setHosts] = useState<SSHHost[]>([])
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [hostModalOpen, setHostModalOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [openingLocal, setOpeningLocal] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; host: SSHHost } | null>(null)
  const [deleteHostConfirm, setDeleteHostConfirm] = useState<SSHHost | null>(null)
  const workspaceRestored = useRef(false)
  const tabsRef = useRef<TerminalTab[]>([])
  tabsRef.current = tabs

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activePaneCount = activeTab ? countLeaves(activeTab.layout) : 0

  useEffect(() => {
    if (activeTab?.kind === 'ssh' && activeTab.hostId) {
      const host = hosts.find((h) => h.id === activeTab.hostId)
      setAgentFocusSSH(activeTab.hostId, host?.name?.trim() || host?.host || activeTab.title)
      return
    }
    setAgentFocusSSH(null)
  }, [activeTab, hosts, setAgentFocusSSH])

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctxMenu])

  const refreshHosts = useCallback(async () => {
    try {
      setHosts(await api.listSSHHosts())
    } catch (e) {
      setHosts([])
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage])

  useEffect(() => {
    if (workspaceRestored.current) {
      refreshHosts()
      return
    }
    workspaceRestored.current = true
    void (async () => {
      try {
        const hostList = await api.listSSHHosts()
        setHosts(hostList)
        const snap = await loadTerminalWorkspace()
        if (!snap?.tabs.length) return
        const restored: TerminalTab[] = []
        for (const tabSnap of snap.tabs) {
          try {
            const tab = await restoreTerminalTab(tabSnap, hostList, confirmTrust)
            if (tab) restored.push(tab)
          } catch {
            /* 跳过无法恢复的会话 */
          }
        }
        if (!restored.length) return
        setTabs(restored)
        const idx = Math.min(Math.max(0, snap.activeTabIndex), restored.length - 1)
        setActiveTabId(restored[idx].id)
        setStatusMessage(t('terminal.restored', { count: restored.length }))
      } catch (e) {
        setHosts([])
        setStatusMessage((e as Error).message)
      }
    })()
  }, [refreshHosts, setStatusMessage, confirmTrust, t])

  useEffect(() => {
    scheduleTerminalWorkspacePersist(toTerminalWorkspaceSnapshot(tabs, activeTabId))
  }, [tabs, activeTabId])

  const updateTab = (tabId: string, patch: Partial<TerminalTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)))
  }

  const openHostModal = (host?: SSHHost) => {
    setEditingHost(host ?? null)
    setHostModalOpen(true)
  }

  const addTab = (info: { sessionId: string; hostId: string; kind: 'local' | 'ssh'; title: string }) => {
    const tabId = `term-${info.sessionId}`
    const paneId = `pane-${info.sessionId}`
    const tab: TerminalTab = {
      id: tabId,
      hostId: info.hostId,
      kind: info.kind,
      title: info.title,
      layout: createLeaf(info.sessionId, paneId),
      activePaneId: paneId,
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tabId)
    setStatusMessage(t('terminal.connected', { title: tab.title }))
    return info.sessionId
  }

  /** writeInitialCommand 连接建立后向终端写入并执行命令（带重试）。 */
  const writeInitialCommand = async (sessionId: string, command?: string) => {
    if (!command?.trim()) return
    const data = command.endsWith('\r') || command.endsWith('\n') ? command : `${command}\r`
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 250 + i * 150))
      try {
        await api.writeTerminal(sessionId, data)
        return
      } catch {
        /* PTY 可能尚未就绪 */
      }
    }
    setStatusMessage(t('terminal.cmdSent'))
  }

  /** runTerminalLink 在已有或新建终端中写入命令。 */
  const runTerminalLink = async (hostId?: string, localShell?: boolean, initialCommand?: string) => {
    if (initialCommand?.trim()) {
      const existing = localShell
        ? tabsRef.current.find((t) => t.kind === 'local')
        : hostId
          ? tabsRef.current.find((t) => t.kind === 'ssh' && t.hostId === hostId)
          : null
      if (existing) {
        const sessionId = firstSessionId(existing.layout)
        if (sessionId) {
          setActiveTabId(existing.id)
          setActiveProduct('terminal')
          await writeInitialCommand(sessionId, initialCommand)
          setStatusMessage(t('terminal.cmdExecuted'))
          return
        }
      }
    }
    if (localShell) {
      await connectLocal(initialCommand)
      return
    }
    if (!hostId) return
    let host = hosts.find((h) => h.id === hostId)
    if (!host) {
      host = await api.getSSHHost(hostId)
      setHosts((prev) => (prev.some((h) => h.id === hostId) ? prev : [...prev, host!]))
    }
    await connectHost(host, initialCommand)
  }

  const connectLocal = async (initialCommand?: string) => {
    if (openingLocal || connectingId) return
    setOpeningLocal(true)
    setStatusMessage(t('terminal.openingLocal'))
    try {
      const info = await api.openLocalTerminal(120, 32)
      const sessionId = addTab({
        sessionId: info.sessionId,
        hostId: '',
        kind: 'local',
        title: info.title || t('terminal.localShellTitle'),
      })
      await writeInitialCommand(sessionId, initialCommand)
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setOpeningLocal(false)
    }
  }

  const connectHost = async (host: SSHHost, initialCommand?: string) => {
    if (connectingId || openingLocal) return
    setConnectingId(host.id)
    setStatusMessage(t('terminal.connecting', { name: host.name }))
    try {
      const info = await withSSHHostTrust(host.host, host.port, () => api.openTerminal(host.id, 120, 32), confirmTrust)
      const sessionId = addTab({
        sessionId: info.sessionId,
        hostId: host.id,
        kind: 'ssh',
        title: info.title || `${host.user}@${host.host}`,
      })
      await writeInitialCommand(sessionId, initialCommand)
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setConnectingId(null)
    }
  }

  useWorkbenchCommand(Capability.TerminalOpen, (cmd) => {
    const hostId = payloadStr(cmd.payload, 'hostId')
    const localShell = payloadBool(cmd.payload, 'localShell')
    const initialCommand = payloadStr(cmd.payload, 'initialCommand')
    void runTerminalLink(hostId, localShell, initialCommand).catch((e) => {
      setStatusMessage((e as Error).message)
    })
  })

  const closeSessions = async (sessionIds: string[]) => {
    for (const sid of sessionIds) {
      try {
        await api.closeTerminal(sid)
      } catch {
        /* ignore */
      }
    }
  }

  const closeTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) await closeSessions(collectSessionIds(tab.layout))
    const next = tabs.filter((t) => t.id !== tabId)
    setTabs(next)
    if (activeTabId === tabId) {
      setActiveTabId(next.length ? next[next.length - 1].id : null)
    }
  }

  const deleteHost = (host: SSHHost) => {
    setCtxMenu(null)
    setDeleteHostConfirm(host)
  }

  const confirmDeleteHost = async () => {
    const host = deleteHostConfirm
    setDeleteHostConfirm(null)
    if (!host) return
    try {
      const related = tabs.filter((t) => t.hostId === host.id)
      for (const t of related) {
        await closeSessions(collectSessionIds(t.layout))
      }
      const nextTabs = tabs.filter((t) => t.hostId !== host.id)
      setTabs(nextTabs)
      if (activeTabId && related.some((t) => t.id === activeTabId)) {
        setActiveTabId(nextTabs.length ? nextTabs[nextTabs.length - 1].id : null)
      }
      await api.deleteSSHHost(host.id)
      await refreshHosts()
      setStatusMessage(t('terminal.deleted', { name: host.name }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** 打开新会话并拆分到当前激活窗格 */
  const splitActivePane = async (direction: 'row' | 'col') => {
    if (!activeTab || splitting) return
    if (activePaneCount >= MAX_PANES) {
      setStatusMessage(t('terminal.maxPanes', { max: MAX_PANES }))
      return
    }
    setSplitting(true)
    setStatusMessage(direction === 'row' ? t('terminal.splittingRow') : t('terminal.splittingCol'))
    try {
      let sessionId: string
      if (activeTab.kind === 'local') {
        const info = await api.openLocalTerminal(120, 32)
        sessionId = info.sessionId
      } else {
        const host = hosts.find((h) => h.id === activeTab.hostId)
        if (!host) throw new Error(t('terminal.errHostNotFound'))
        const info = await withSSHHostTrust(host.host, host.port, () =>
          api.openTerminal(activeTab.hostId, 120, 32),
          confirmTrust
        )
        sessionId = info.sessionId
      }
      const nextLayout = splitPane(activeTab.layout, activeTab.activePaneId, direction, sessionId)
      if (!nextLayout) throw new Error(t('terminal.splitFailed'))
      updateTab(activeTab.id, {
        layout: nextLayout,
        activePaneId: `pane-${sessionId}`,
      })
      setStatusMessage(t('terminal.splitDone'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setSplitting(false)
    }
  }

  /** 关闭指定分屏窗格 */
  const closePaneInTab = async (tabId: string, paneId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || countLeaves(tab.layout) <= 1) return
    const pane = findPane(tab.layout, paneId)
    if (!pane || pane.kind !== 'leaf') return
    try {
      await api.closeTerminal(pane.sessionId)
    } catch {
      /* ignore */
    }
    const nextLayout = closePane(tab.layout, paneId)
    if (!nextLayout) return
    updateTab(tabId, {
      layout: nextLayout,
      activePaneId: tab.activePaneId === paneId ? firstLeafId(nextLayout) : tab.activePaneId,
    })
    setStatusMessage(t('terminal.paneClosed'))
  }

  /** 关闭当前激活分屏窗格 */
  const closeActivePane = async () => {
    if (!activeTab || activePaneCount <= 1) return
    await closePaneInTab(activeTab.id, activeTab.activePaneId)
  }

  const connectedHostIds = new Set(tabs.filter((t) => t.kind === 'ssh').map((t) => t.hostId))
  const localTabCount = tabs.filter((t) => t.kind === 'local').length

  return (
    <div className="product-workbench terminal-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button
            type="button"
            className="wn-btn wn-btn-chrome wn-btn-run"
            onClick={() => void connectLocal()}
            disabled={openingLocal}
          >
            <IconLaptop size={13} />
            <span>{t('terminal.localTerminal')}</span>
          </button>
          <span className="chrome-vrule" />
          <button type="button" className="wn-btn wn-btn-chrome" onClick={() => openHostModal()}>
            <IconPlus size={13} />
            <span>{t('terminal.sshHosts')}</span>
          </button>
          {activeTab && (
            <>
              <span className="chrome-vrule" />
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.splitRowTitle')}
                disabled={splitting || activePaneCount >= MAX_PANES}
                onClick={() => splitActivePane('row')}
              >
                <span className="terminal-toolbar-glyph">▥</span>
                <span>{t('terminal.splitRow')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.splitColTitle')}
                disabled={splitting || activePaneCount >= MAX_PANES}
                onClick={() => splitActivePane('col')}
              >
                <span className="terminal-toolbar-glyph">▤</span>
                <span>{t('terminal.splitCol')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.closeSplitTitle')}
                disabled={activePaneCount <= 1}
                onClick={closeActivePane}
              >
                <span>{t('terminal.closeSplit')}</span>
              </button>
            </>
          )}
        </nav>
        <span className="chrome-spacer" />
        <label className="terminal-opacity-control" title={t('terminal.opacityTitle')}>
          <span>{t('terminal.opacity')}</span>
          <input
            type="range"
            min={40}
            max={100}
            value={Math.round(terminalOpacity * 100)}
            onChange={(e) => setTerminalOpacity(Number(e.target.value) / 100)}
          />
          <span className="terminal-opacity-value">{Math.round(terminalOpacity * 100)}%</span>
        </label>
        <span className="product-toolbar-status">
          {tabs.length > 0 ? t('terminal.sessionCount', { count: tabs.length }) : t('common.notConnected')}
        </span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar terminal-sidebar">
          <section className="sidebar-section connections">
            <div className="sidebar-header">
              <span>{t('terminal.localSection')}</span>
            </div>
            <div className="sidebar-body connections-body">
              <ul className="conn-list">
                <li
                  className={`conn-item ${openingLocal ? 'active' : ''} ${localTabCount > 0 ? 'connected' : ''}`}
                  onClick={() => void connectLocal()}
                  onDoubleClick={() => void connectLocal()}
                >
                  <IconLaptop size={14} className="mock-icon" />
                  <div className="conn-meta">
                    <span className="conn-name">{t('terminal.localShell')}</span>
                    <span className="conn-host">{t('terminal.localMeta')}</span>
                  </div>
                </li>
              </ul>
            </div>
          </section>

          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('terminal.sshHosts')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => openHostModal()} title={t('common.new')}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {hosts.length === 0 ? (
                <div className="empty-hint">{t('terminal.emptyHosts')}</div>
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
              <div className="empty-hint mock-hint">{t('terminal.sshHint')}</div>
            </div>
          </section>

          <SSHForwardPanel hosts={hosts} onStatus={setStatusMessage} />
        </aside>

        <main className="app-main">
          <div className="editor-chrome">
            <div className="wn-tabs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`wn-tab wn-tab-terminal wn-tab-${t.kind} ${t.id === activeTabId ? 'active' : ''}`}
                  onClick={() => setActiveTabId(t.id)}
                >
                  {t.kind === 'local' ? <IconLaptop size={12} /> : <IconTerminal size={12} />}
                  <span className="tab-title">{t.title}</span>
                  {countLeaves(t.layout) > 1 && (
                    <span className="tab-split-badge">{countLeaves(t.layout)}</span>
                  )}
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
          <div
            className="workspace terminal-workspace"
            style={{ backgroundColor: terminalBackground(terminalOpacity) }}
          >
            {tabs.length === 0 && (
              <div className="pane-empty">
                <span>{t('terminal.emptyWorkspace')}</span>
              </div>
            )}
            {tabs.map((t) => (
              <div
                key={t.id}
                className="terminal-pane-wrap"
                style={{ display: t.id === activeTabId ? 'flex' : 'none' }}
              >
                <TerminalSplitView
                  layout={t.layout}
                  rootLayout={t.layout}
                  activePaneId={t.activePaneId}
                  opacity={terminalOpacity}
                  onSelectPane={(paneId) => updateTab(t.id, { activePaneId: paneId })}
                  onLayoutChange={(layout) => updateTab(t.id, { layout })}
                  onClosePane={(paneId) => closePaneInTab(t.id, paneId)}
                />
              </div>
            ))}
          </div>
        </main>
      </div>

      <SSHHostModal
        open={hostModalOpen}
        initial={editingHost}
        onClose={() => setHostModalOpen(false)}
        onSaved={refreshHosts}
      />

      {ctxMenu && (
        <div
          className="wn-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              openProductLink({ action: 'notebook', hostId: ctxMenu.host.id })
            }}
          >
            {t('terminal.ctxNotebook')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              openProductLink({ action: 'docker-context', hostId: ctxMenu.host.id })
            }}
          >
            {t('terminal.ctxDocker')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              openProductLink({ action: 'sftp', hostId: ctxMenu.host.id })
            }}
          >
            {t('terminal.ctxSftp')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              openHostModal(ctxMenu.host)
            }}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="wn-context-item danger"
            onClick={() => deleteHost(ctxMenu.host)}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
      {trustDialog}
      <ConfirmDialog
        open={deleteHostConfirm != null}
        title={t('terminal.deleteHostTitle')}
        message={deleteHostConfirm ? t('terminal.deleteHostMsg', { name: deleteHostConfirm.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void confirmDeleteHost()}
        onCancel={() => setDeleteHostConfirm(null)}
      />
    </div>
  )
}

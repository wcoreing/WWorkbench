import { useCallback, useEffect, useRef, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { IconLaptop, IconPlus, IconServer, IconTerminal } from '../../components/Icons'
import { useAppStore } from '../../stores/appStore'
import {
  loadTerminalWorkspace,
  scheduleTerminalWorkspacePersist,
  toTerminalWorkspaceSnapshot,
} from '../../stores/terminalWorkspacePersist'
import { restoreTerminalTab } from '../../features/terminal/restoreTerminalWorkspace'
import { SSHHostModal } from '../../features/terminal/SSHHostModal'
import { useSSHTrustConfirm } from '../../features/terminal/useSSHTrustConfirm'
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
  const { setStatusMessage, terminalOpacity, setTerminalOpacity, productLink, setProductLink, setActiveProduct } = useAppStore()
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
  const workspaceRestored = useRef(false)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activePaneCount = activeTab ? countLeaves(activeTab.layout) : 0

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
        setStatusMessage(`已恢复 ${restored.length} 个终端会话`)
      } catch (e) {
        setHosts([])
        setStatusMessage((e as Error).message)
      }
    })()
  }, [refreshHosts, setStatusMessage, confirmTrust])

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
    setStatusMessage(`已连接 ${tab.title}`)
    return info.sessionId
  }

  /** writeInitialCommand 连接建立后向终端写入初始命令。 */
  const writeInitialCommand = async (sessionId: string, command?: string) => {
    if (!command) return
    await new Promise((r) => setTimeout(r, 450))
    const data = command.endsWith('\r') || command.endsWith('\n') ? command : `${command}\r`
    await api.writeTerminal(sessionId, data)
  }

  const connectLocal = async (initialCommand?: string) => {
    if (openingLocal || connectingId) return
    setOpeningLocal(true)
    setStatusMessage('正在打开本机终端…')
    try {
      const info = await api.openLocalTerminal(120, 32)
      const sessionId = addTab({
        sessionId: info.sessionId,
        hostId: '',
        kind: 'local',
        title: info.title || '本机 Shell',
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
    setStatusMessage(`正在连接 ${host.name}…`)
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

  useEffect(() => {
    if (!productLink || productLink.action !== 'terminal') return
    const { hostId, localShell, initialCommand } = productLink
    setProductLink(null)
    void (async () => {
      try {
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
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  }, [productLink])

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

  const deleteHost = async (host: SSHHost) => {
    setCtxMenu(null)
    if (!window.confirm(`确定删除 SSH 主机「${host.name}」？`)) return
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
      setStatusMessage(`已删除 ${host.name}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** 打开新会话并拆分到当前激活窗格 */
  const splitActivePane = async (direction: 'row' | 'col') => {
    if (!activeTab || splitting) return
    if (activePaneCount >= MAX_PANES) {
      setStatusMessage(`最多 ${MAX_PANES} 个分屏`)
      return
    }
    setSplitting(true)
    setStatusMessage(direction === 'row' ? '正在垂直分屏…' : '正在水平分屏…')
    try {
      let sessionId: string
      if (activeTab.kind === 'local') {
        const info = await api.openLocalTerminal(120, 32)
        sessionId = info.sessionId
      } else {
        const host = hosts.find((h) => h.id === activeTab.hostId)
        if (!host) throw new Error('SSH 主机不存在')
        const info = await withSSHHostTrust(host.host, host.port, () =>
          api.openTerminal(activeTab.hostId, 120, 32),
          confirmTrust
        )
        sessionId = info.sessionId
      }
      const nextLayout = splitPane(activeTab.layout, activeTab.activePaneId, direction, sessionId)
      if (!nextLayout) throw new Error('分屏失败')
      updateTab(activeTab.id, {
        layout: nextLayout,
        activePaneId: `pane-${sessionId}`,
      })
      setStatusMessage('已分屏')
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
    setStatusMessage('已关闭分屏')
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
            <span>本机终端</span>
          </button>
          <span className="chrome-vrule" />
          <button type="button" className="wn-btn wn-btn-chrome" onClick={() => openHostModal()}>
            <IconPlus size={13} />
            <span>SSH 主机</span>
          </button>
          {activeTab && (
            <>
              <span className="chrome-vrule" />
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title="垂直分屏（左右）"
                disabled={splitting || activePaneCount >= MAX_PANES}
                onClick={() => splitActivePane('row')}
              >
                <span className="terminal-toolbar-glyph">▥</span>
                <span>垂直分屏</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title="水平分屏（上下）"
                disabled={splitting || activePaneCount >= MAX_PANES}
                onClick={() => splitActivePane('col')}
              >
                <span className="terminal-toolbar-glyph">▤</span>
                <span>水平分屏</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title="关闭当前分屏"
                disabled={activePaneCount <= 1}
                onClick={closeActivePane}
              >
                <span>关闭分屏</span>
              </button>
            </>
          )}
        </nav>
        <span className="chrome-spacer" />
        <label className="terminal-opacity-control" title="终端背景透明度">
          <span>透明度</span>
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
          {tabs.length > 0 ? `${tabs.length} 个会话` : '未连接'}
        </span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar terminal-sidebar">
          <section className="sidebar-section connections">
            <div className="sidebar-header">
              <span>本机</span>
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
                    <span className="conn-name">本地 Shell</span>
                    <span className="conn-host">zsh / bash · 当前 Mac</span>
                  </div>
                </li>
              </ul>
            </div>
          </section>

          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>SSH 主机</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" onClick={() => openHostModal()} title="新建">
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {hosts.length === 0 ? (
                <div className="empty-hint">添加 SSH 主机连接远程</div>
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
              <div className="empty-hint mock-hint">SSH：单击连接 · 右键菜单</div>
            </div>
          </section>
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
                <span>打开本机终端，或选择 SSH 主机连接远程</span>
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
              setActiveProduct('docker')
              setProductLink({ action: 'docker-context', hostId: ctxMenu.host.id })
            }}
          >
            添加 Docker 远程
          </button>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              setActiveProduct('sftp')
              setProductLink({ action: 'sftp', hostId: ctxMenu.host.id })
            }}
          >
            打开 SFTP
          </button>
          <button
            type="button"
            className="wn-context-item"
            onClick={() => {
              setCtxMenu(null)
              openHostModal(ctxMenu.host)
            }}
          >
            编辑
          </button>
          <button
            type="button"
            className="wn-context-item danger"
            onClick={() => deleteHost(ctxMenu.host)}
          >
            删除
          </button>
        </div>
      )}
      {trustDialog}
    </div>
  )
}

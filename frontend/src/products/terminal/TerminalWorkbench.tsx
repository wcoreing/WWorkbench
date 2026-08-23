import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShellHost, SSHHost } from '../../api/types'
import { shellHostAsSSH } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import { ProductLayout } from '../../components/layout'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { IconCopy, IconDocker, IconLaptop, IconPlus, IconRefresh, IconServer, IconTerminal } from '../../components/Icons'
import { openAgentDraft, mentionSSH, mentionDockerHost } from '../../features/agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildTerminalSurface } from '../../stores/agentSurface'
import { openNotebook, openDockerContextFromHost, openSftp, openLogs, openSSHForward, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadBool, payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { pressProps, useDismissOverlays } from '../../components/compat'
import {
  loadTerminalWorkspace,
  scheduleTerminalWorkspacePersist,
  toTerminalWorkspaceSnapshot,
} from '../../stores/terminalWorkspacePersist'
import { restoreTerminalTab } from '../../features/terminal/restoreTerminalWorkspace'
import { SSHHostModal } from '../../features/terminal/SSHHostModal'
import { useSSHTrustConfirm } from '../../features/terminal/useSSHTrustConfirm'
import { LocalPortsDialog } from '../../features/terminal/LocalPortsPanel'
import { SSHForwardPanel } from '../../features/terminal/SSHForwardPanel'
import { TerminalSplitView } from '../../features/terminal/TerminalSplitView'
import { TerminalTabStatusPane } from '../../features/terminal/TerminalTabStatusPane'
import { focusTerminalSession } from '../../features/terminal/terminalFocus'
import { terminalClipboard } from '../../features/terminal/terminalClipboard'
import { useScrollActiveTabIntoView } from '../../hooks/useScrollActiveTabIntoView'
import { terminalBackground } from '../../features/terminal/TerminalPane'
import {
  closePane,
  collectSessionIds,
  countLeaves,
  createLeaf,
  findPane,
  firstLeafId,
  replaceSessionIds,
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
  kind: 'local' | 'ssh' | 'docker'
  title: string
  layout: PaneLayout
  activePaneId: string
  connectState: 'connecting' | 'ready' | 'failed'
  connectError?: string
  connectHost?: ShellHost
  /** 最近一次被激活（用于侧栏单击回到最近窗口） */
  focusedAt?: number
}

/** isLiveSessionId 是否为已建立的后端会话。 */
function isLiveSessionId(sessionId: string): boolean {
  return !sessionId.startsWith('pending-')
}

const MAX_PANES = 4

/** 终端产品线工作区 */
export function TerminalWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, terminalOpacity, setTerminalOpacity, setActiveProduct, setAgentSurface, activeProduct } =
    useAppStore()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [hosts, setHosts] = useState<ShellHost[]>([])
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [hostModalOpen, setHostModalOpen] = useState(false)
  const [localPortsOpen, setLocalPortsOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null)
  const [reconnectingTabId, setReconnectingTabId] = useState<string | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<
    { x: number; y: number; host: ShellHost | 'local' } | null
  >(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  const [deleteHostConfirm, setDeleteHostConfirm] = useState<ShellHost | null>(null)
  const workspaceRestored = useRef(false)
  const tabsRef = useRef<TerminalTab[]>([])
  const prevProductRef = useRef(activeProduct)
  tabsRef.current = tabs

  useDismissOverlays(() => {
    setCtxMenu(null)
    setTabCtxMenu(null)
  })

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activeLeaf = (() => {
    if (!activeTab) return null
    const pane = findPane(activeTab.layout, activeTab.activePaneId)
    return pane?.kind === 'leaf' ? pane : null
  })()
  const tabStripRef = useScrollActiveTabIntoView(activeTabId)
  const activePaneCount = activeTab ? countLeaves(activeTab.layout) : 0

  useEffect(() => {
    if (activeProduct !== 'terminal') return
    if (!activeTab) {
      setAgentSurface(buildTerminalSurface({ kind: '', title: '' }))
      return
    }
    const host = hosts.find((h) => h.id === activeTab.hostId)
    const hostLabel = host?.name?.trim() || host?.host || activeTab.title
    const openTabsBrief = tabs
      .slice(0, 12)
      .map((t) => `${t.title}(${t.kind})`)
      .join(' · ')
    setAgentSurface(
      buildTerminalSurface({
        kind: activeTab.kind,
        title: activeTab.title,
        hostId: activeTab.hostId,
        hostLabel,
        openTabsBrief,
      }),
    )
  }, [activeProduct, activeTab, hosts, tabs, setAgentSurface])

  const sshHosts = hosts.filter((h) => h.kind === 'ssh').map((h) => shellHostAsSSH(h)!).filter(Boolean)
  const dockerHosts = hosts.filter((h) => h.kind === 'docker')

  const refreshHosts = useCallback(async () => {
    try {
      setHosts(await api.listShellHosts())
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
        const hostList = await api.listShellHosts()
        setHosts(hostList)
        const snap = await loadTerminalWorkspace()
        if (!snap?.tabs.length) return
        const restored: TerminalTab[] = []
        for (const tabSnap of snap.tabs) {
          try {
            const tab = await restoreTerminalTab(tabSnap, hostList, confirmTrust)
            if (tab) restored.push({ ...tab, connectState: 'ready' })
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
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain !== 'ssh.host') return
      await refreshHosts()
      if (evt.label) {
        useAppStore.getState().setStatusMessage(
          evt.op === 'delete' ? `SSH 主机已删除：${evt.label}` : `SSH 主机已更新：${evt.label}`,
        )
      }
    }
    for (const evt of takePendingWorkbenchChanged('ssh.host')) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [refreshHosts])

  useEffect(() => {
    if (activeProduct !== 'terminal') {
      setCtxMenu(null)
      setTabCtxMenu(null)
      prevProductRef.current = activeProduct
      return
    }
    if (prevProductRef.current !== 'terminal') {
      const tab = tabs.find((t) => t.id === activeTabId)
      if (tab?.connectState === 'ready') {
        const sid = firstSessionId(tab.layout)
        if (sid && isLiveSessionId(sid)) {
          requestAnimationFrame(() => focusTerminalSession(sid))
        }
      }
    }
    prevProductRef.current = activeProduct
  }, [activeProduct, activeTabId, tabs])

  useEffect(() => {
    const readyTabs = tabs.filter((t) => t.connectState === 'ready')
    scheduleTerminalWorkspacePersist(toTerminalWorkspaceSnapshot(readyTabs, activeTabId))
  }, [tabs, activeTabId])

  const selectTab = (tabId: string) => {
    setTabCtxMenu(null)
    setCtxMenu(null)
    setActiveTabId(tabId)
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, focusedAt: Date.now() } : t)),
    )
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (tab?.connectState === 'ready') {
      const sid = firstSessionId(tab.layout)
      if (!sid || !isLiveSessionId(sid)) return
      requestAnimationFrame(() => focusTerminalSession(sid))
    }
  }

  const updateTab = (tabId: string, patch: Partial<TerminalTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)))
  }

  const openHostModal = (host?: SSHHost) => {
    setEditingHost(host ?? null)
    setHostModalOpen(true)
  }

  const addTab = (info: { sessionId: string; hostId: string; kind: 'local' | 'ssh' | 'docker'; title: string }) => {
    const tabId = `term-${info.sessionId}`
    const paneId = `pane-${info.sessionId}`
    const tab: TerminalTab = {
      id: tabId,
      hostId: info.hostId,
      kind: info.kind,
      title: info.title,
      layout: createLeaf(info.sessionId, paneId),
      activePaneId: paneId,
      connectState: 'ready',
      focusedAt: Date.now(),
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tabId)
    setStatusMessage(t('terminal.connected', { title: tab.title }))
    return info.sessionId
  }

  const createPendingTab = (opts: {
    hostId: string
    kind: 'local' | 'ssh' | 'docker'
    title: string
    host?: ShellHost
  }): string => {
    const tabId = `pending-${crypto.randomUUID()}`
    const paneId = `pane-${tabId}`
    const tab: TerminalTab = {
      id: tabId,
      hostId: opts.hostId,
      kind: opts.kind,
      title: opts.title,
      layout: createLeaf(`pending-${tabId}`, paneId),
      activePaneId: paneId,
      connectState: 'connecting',
      connectHost: opts.host,
      focusedAt: Date.now(),
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tabId)
    return tabId
  }

  const activateTab = (tabId: string, info: { sessionId: string; title?: string }) => {
    const newTabId = `term-${info.sessionId}`
    setTabs((prev) => {
      if (!prev.some((t) => t.id === tabId)) return prev
      return prev.map((t) =>
        t.id === tabId
          ? {
              ...t,
              id: newTabId,
              title: info.title ?? t.title,
              layout: createLeaf(info.sessionId, `pane-${info.sessionId}`),
              activePaneId: `pane-${info.sessionId}`,
              connectState: 'ready' as const,
              connectError: undefined,
              connectHost: undefined,
              focusedAt: Date.now(),
            }
          : t,
      )
    })
    setActiveTabId(newTabId)
  }

  const failTab = (tabId: string, error: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, connectState: 'failed' as const, connectError: error } : t)),
    )
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
        ? tabsRef.current.find((t) => t.kind === 'local' && t.connectState === 'ready')
        : hostId
          ? tabsRef.current.find(
            (t) =>
              (t.kind === 'ssh' || t.kind === 'docker') &&
              t.hostId === hostId &&
              t.connectState === 'ready',
          )
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
      host = await api.getShellHost(hostId)
      setHosts((prev) => (prev.some((h) => h.id === hostId) ? prev : [...prev, host!]))
    }
    await connectHost(host, initialCommand)
  }

  const connectLocal = async (initialCommand?: string) => {
    const title = t('terminal.localShellTitle')
    const tabId = createPendingTab({ hostId: '', kind: 'local', title })
    setStatusMessage(t('terminal.openingLocal'))
    try {
      const info = await api.openLocalTerminal(120, 32)
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      activateTab(tabId, { sessionId: info.sessionId, title: info.title || title })
      setStatusMessage(t('terminal.connected', { title: info.title || title }))
      await writeInitialCommand(info.sessionId, initialCommand)
    } catch (e) {
      const message = (e as Error).message
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      failTab(tabId, message)
      setStatusMessage(message)
    }
  }

  const resolveHost = async (hostId: string): Promise<ShellHost> => {
    let host = hosts.find((h) => h.id === hostId)
    if (!host) {
      host = await api.getShellHost(hostId)
      setHosts((prev) => (prev.some((h) => h.id === hostId) ? prev : [...prev, host!]))
    }
    return host
  }

  const openRemoteSession = async (host: ShellHost) => {
    const open = () => api.openTerminal(host.id, 120, 32)
    return host.kind === 'docker'
      ? open()
      : withSSHHostTrust(host.host || '', host.port || 22, open, confirmTrust)
  }

  const openSessionForTab = async (tab: TerminalTab): Promise<string> => {
    if (tab.kind === 'local') {
      const info = await api.openLocalTerminal(120, 32)
      return info.sessionId
    }
    const host = await resolveHost(tab.hostId)
    if (host.kind === 'docker' && host.running === false) {
      throw new Error(t('terminal.containerStoppedHint', { name: host.name }))
    }
    const info = await openRemoteSession(host)
    return info.sessionId
  }

  const connectHost = async (host: ShellHost, initialCommand?: string) => {
    if (host.kind === 'docker' && host.running === false) {
      setStatusMessage(t('terminal.containerStoppedHint', { name: host.name }))
      return
    }
    const title = host.kind === 'docker' ? host.name : `${host.user}@${host.host}:${host.port || 22}`
    const tabId = createPendingTab({
      hostId: host.id,
      kind: host.kind === 'docker' ? 'docker' : 'ssh',
      title,
      host,
    })
    setStatusMessage(t('terminal.connecting', { name: title }))
    try {
      const info = await openRemoteSession(host)
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      activateTab(tabId, { sessionId: info.sessionId, title: info.title || title })
      setStatusMessage(t('terminal.connected', { title: info.title || title }))
      await writeInitialCommand(info.sessionId, initialCommand)
    } catch (e) {
      const message = (e as Error).message
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      failTab(tabId, message)
      setStatusMessage(message)
    }
  }

  const retryTabConnect = async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab || tab.connectState !== 'failed') return
    updateTab(tabId, { connectState: 'connecting', connectError: undefined })
    setActiveTabId(tabId)
    setStatusMessage(t('terminal.reconnecting', { name: tab.title }))
    try {
      if (tab.kind === 'local') {
        const info = await api.openLocalTerminal(120, 32)
        if (!tabsRef.current.some((t) => t.id === tabId)) return
        activateTab(tabId, { sessionId: info.sessionId, title: info.title || tab.title })
      } else {
        const host = tab.connectHost ?? (await resolveHost(tab.hostId))
        const info = await openRemoteSession(host)
        if (!tabsRef.current.some((t) => t.id === tabId)) return
        activateTab(tabId, { sessionId: info.sessionId, title: info.title || tab.title })
      }
      setStatusMessage(t('terminal.connected', { title: tab.title }))
    } catch (e) {
      const message = (e as Error).message
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      failTab(tabId, message)
      setStatusMessage(message)
    }
  }

  /** reconnectTab 关闭并重开会话，保留分屏布局。 */
  const reconnectTab = async (tabId: string) => {
    if (reconnectingTabId) return
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.connectState === 'failed') {
      await retryTabConnect(tabId)
      return
    }
    if (tab.connectState !== 'ready') return

    setReconnectingTabId(tabId)
    setActiveTabId(tabId)
    setStatusMessage(t('terminal.reconnecting', { name: tab.title }))
    try {
      await closeSessions(collectSessionIds(tab.layout))
      const paneCount = countLeaves(tab.layout)
      const newSessionIds: string[] = []
      for (let i = 0; i < paneCount; i++) {
        newSessionIds.push(await openSessionForTab(tab))
      }
      const newLayout = replaceSessionIds(tab.layout, newSessionIds)
      const newTabId = `term-${newSessionIds[0]}`
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                id: newTabId,
                layout: newLayout,
                activePaneId: firstLeafId(newLayout),
                connectState: 'ready' as const,
                connectError: undefined,
              }
            : t,
        ),
      )
      setActiveTabId(newTabId)
      setStatusMessage(t('terminal.reconnected', { name: tab.title }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setReconnectingTabId(null)
    }
  }

  /** pickRecentTab 在同类标签里选最近聚焦的一个。 */
  const pickRecentTab = (related: TerminalTab[]): TerminalTab | null => {
    if (related.length === 0) return null
    let recent = related[0]
    for (const cur of related) {
      if ((cur.focusedAt ?? 0) >= (recent.focusedAt ?? 0)) recent = cur
    }
    return recent
  }

  /** openRecentLocalWindow 单击本机：回到最近本机窗口；没有则新建。 */
  const openRecentLocalWindow = async () => {
    const recent = pickRecentTab(tabs.filter((t) => t.kind === 'local'))
    if (recent) {
      selectTab(recent.id)
      return
    }
    await connectLocal()
  }

  /** openRecentHostWindow 单击：回到该主机最近窗口；没有则新建连接。 */
  const openRecentHostWindow = async (host: ShellHost) => {
    if (host.kind === 'docker' && host.running === false) {
      setStatusMessage(t('terminal.containerStoppedHint', { name: host.name }))
      return
    }
    const related = tabs.filter(
      (t) => (t.kind === 'ssh' || t.kind === 'docker') && t.hostId === host.id,
    )
    const recent = pickRecentTab(related)
    if (recent) {
      selectTab(recent.id)
      return
    }
    await connectHost(host)
  }

  /** newHostConnection 右键：始终新建一条连接会话。 */
  const newHostConnection = async (host: ShellHost) => {
    if (host.kind === 'docker' && host.running === false) {
      setStatusMessage(t('terminal.containerStoppedHint', { name: host.name }))
      return
    }
    await connectHost(host)
  }

  useWorkbenchCommand(Capability.ShellRun, (cmd) => {
    const hostId = payloadStr(cmd.payload, 'hostId')
    const localShell = payloadBool(cmd.payload, 'localShell')
    const initialCommand = payloadStr(cmd.payload, 'initialCommand')
    void runTerminalLink(hostId, localShell, initialCommand).catch((e) => {
      setStatusMessage((e as Error).message)
    })
  })

  const closeSessions = async (sessionIds: string[]) => {
    for (const sid of sessionIds) {
      if (!isLiveSessionId(sid)) continue
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

  /** closeOtherTabs 关闭除当前外的终端标签。 */
  const closeOtherTabs = async (keepId: string) => {
    const closing = tabs.filter((t) => t.id !== keepId)
    for (const tab of closing) {
      await closeSessions(collectSessionIds(tab.layout))
    }
    setTabs(tabs.filter((t) => t.id === keepId))
    setActiveTabId(keepId)
  }

  /** closeAllTabs 关闭全部终端标签。 */
  const closeAllTabs = async () => {
    for (const tab of tabs) {
      await closeSessions(collectSessionIds(tab.layout))
    }
    setTabs([])
    setActiveTabId(null)
  }

  const deleteHost = (host: ShellHost) => {
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
      if (host.kind === 'docker') {
        await api.removeDockerHost(host.id)
      } else {
        await api.deleteSSHHost(host.id)
      }
      await refreshHosts()
      setStatusMessage(t('terminal.deleted', { name: host.name }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** 打开新会话并拆分到当前激活窗格 */
  const splitActivePane = async (direction: 'row' | 'col') => {
    if (!activeTab || activeTab.connectState !== 'ready' || splitting) return
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
        const host = await resolveHost(activeTab.hostId)
        const info = await openRemoteSession(host)
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
    if (!tab || tab.connectState !== 'ready' || countLeaves(tab.layout) <= 1) return
    const pane = findPane(tab.layout, paneId)
    if (!pane || pane.kind !== 'leaf' || !isLiveSessionId(pane.sessionId)) return
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

  const connectedHostIds = new Set(
    tabs.filter((t) => t.connectState === 'ready' && (t.kind === 'ssh' || t.kind === 'docker')).map((t) => t.hostId),
  )
  const localTabCount = tabs.filter((t) => t.connectState === 'ready' && t.kind === 'local').length
  const readyTabCount = tabs.filter((t) => t.connectState === 'ready').length

  const toolbarStatus = (() => {
    if (activeTab?.connectState === 'connecting') {
      return {
        dot: 'pending',
        label: t('terminal.connecting', { name: activeTab.title }),
        title: t('terminal.connecting', { name: activeTab.title }),
      }
    }
    if (activeTab?.connectState === 'failed') {
      return {
        dot: 'error',
        label: t('terminal.connectFailed', { name: activeTab.title }),
        title: activeTab.connectError || t('terminal.connectFailed', { name: activeTab.title }),
      }
    }
    if (readyTabCount > 0) {
      return {
        dot: 'online',
        label: t('terminal.sessionCount', { count: readyTabCount }),
        title: t('terminal.sessionCount', { count: readyTabCount }),
      }
    }
    if (tabs.some((t) => t.connectState === 'connecting')) {
      const pending = tabs.find((t) => t.connectState === 'connecting')
      return {
        dot: 'pending',
        label: t('terminal.connecting', { name: pending?.title ?? '' }),
        title: t('terminal.connecting', { name: pending?.title ?? '' }),
      }
    }
    return { dot: '', label: t('common.notConnected'), title: t('common.notConnected') }
  })()

  const hostItemActive = (hostId: string) =>
    activeTab?.hostId === hostId ||
    tabs.some((t) => t.hostId === hostId && t.connectState === 'connecting')

  const localItemActive = () =>
    activeTab?.kind === 'local' || tabs.some((t) => t.kind === 'local' && t.connectState === 'connecting')

  return (
    <div className="product-workbench terminal-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button
            type="button"
            className="wn-btn wn-btn-chrome wn-btn-run"
            {...pressProps(() => void connectLocal())}
          >
            <IconLaptop size={13} />
            <span>{t('terminal.localTerminal')}</span>
          </button>
          <span className="chrome-vrule" />
          <button type="button" className="wn-btn wn-btn-chrome" {...pressProps(() => openHostModal())}>
            <IconPlus size={13} />
            <span>{t('terminal.sshHosts')}</span>
          </button>
          {activeTab?.connectState === 'ready' && (
            <>
              <span className="chrome-vrule" />
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.reconnect')}
                disabled={Boolean(reconnectingTabId) || splitting}
                {...pressProps(() => void reconnectTab(activeTab.id), {
                  disabled: Boolean(reconnectingTabId) || splitting,
                })}
              >
                <IconRefresh size={13} />
                <span>{t('terminal.reconnect')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.splitRowTitle')}
                disabled={splitting || activePaneCount >= MAX_PANES}
                {...pressProps(() => splitActivePane('row'), {
                  disabled: splitting || activePaneCount >= MAX_PANES,
                })}
              >
                <span className="terminal-toolbar-glyph">▥</span>
                <span>{t('terminal.splitRow')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.splitColTitle')}
                disabled={splitting || activePaneCount >= MAX_PANES}
                {...pressProps(() => splitActivePane('col'), {
                  disabled: splitting || activePaneCount >= MAX_PANES,
                })}
              >
                <span className="terminal-toolbar-glyph">▤</span>
                <span>{t('terminal.splitCol')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.copyHint')}
                disabled={!activeLeaf || !isLiveSessionId(activeLeaf.sessionId)}
                {...pressProps(
                  () => {
                    const sid = activeLeaf?.sessionId
                    if (!sid) return
                    void terminalClipboard(sid)
                      ?.copy()
                      .then((text) => {
                        if (!text) setStatusMessage(t('terminal.copyEmpty'))
                      })
                  },
                  { disabled: !activeLeaf || !isLiveSessionId(activeLeaf?.sessionId ?? '') },
                )}
              >
                <IconCopy size={13} />
                <span>{t('terminal.copy')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.paste')}
                disabled={!activeLeaf || !isLiveSessionId(activeLeaf.sessionId)}
                {...pressProps(
                  () => {
                    const sid = activeLeaf?.sessionId
                    if (!sid) return
                    void terminalClipboard(sid)?.paste()
                  },
                  { disabled: !activeLeaf || !isLiveSessionId(activeLeaf?.sessionId ?? '') },
                )}
              >
                <span>{t('terminal.paste')}</span>
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-chrome"
                title={t('terminal.closeSplitTitle')}
                disabled={activePaneCount <= 1}
                {...pressProps(closeActivePane, { disabled: activePaneCount <= 1 })}
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
            min={15}
            max={100}
            value={Math.round(terminalOpacity * 100)}
            onChange={(e) => setTerminalOpacity(Number(e.target.value) / 100)}
          />
          <span className="terminal-opacity-value">{Math.round(terminalOpacity * 100)}%</span>
        </label>
        <span className="product-toolbar-status" title={toolbarStatus.title}>
          <span className={`status-dot ${toolbarStatus.dot}`} />
          <span>{toolbarStatus.label}</span>
        </span>
      </div>

      <ProductLayout
        storageKey="terminal_sidebar_width"
        resizeTitle={t('common.resizeWidth')}
        sidebarClassName="terminal-sidebar"
        sidebar={
          <>
            <section className="sidebar-section connections">
              <div className="sidebar-header">
                <span>{t('terminal.localSection')}</span>
              </div>
              <div className="sidebar-body connections-body">
                <ul className="conn-list">
                  <li
                    className={`conn-item ${localItemActive() ? 'active' : ''} ${localTabCount > 0 ? 'connected' : ''}`}
                    {...pressProps(() => void openRecentLocalWindow())}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu({ x: e.clientX, y: e.clientY, host: 'local' })
                    }}
                  >
                    <IconLaptop size={14} className="mock-icon" />
                    <div className="conn-meta">
                      <span className="conn-name">{t('terminal.localShell')}</span>
                      <span className="conn-host" title={t('terminal.localMeta')}>
                        {t('terminal.localMeta')}
                      </span>
                    </div>
                  </li>
                </ul>
              </div>
            </section>

            <section className="sidebar-section">
              <div className="sidebar-header">
                <span>{t('terminal.sshHosts')}</span>
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" {...pressProps(() => openHostModal())} title={t('common.new')}>
                  <IconPlus size={14} />
                </button>
              </div>
              <div className="sidebar-body">
                {sshHosts.length === 0 ? (
                  <EmptyState
                    variant="inline"
                    title={t('terminal.emptyHosts')}
                    actions={[{ label: t('terminal.addHost'), onPress: () => openHostModal(), primary: true }]}
                  />
                ) : (
                  <ul className="conn-list">
                    {sshHosts.map((h) => {
                      const hostLine = `${h.user}@${h.host}:${h.port}`
                      return (
                        <li
                          key={h.id}
                          className={`conn-item ${hostItemActive(h.id) ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''}`}
                          {...pressProps(() => void openRecentHostWindow({ ...h, kind: 'ssh' }))}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCtxMenu({ x: e.clientX, y: e.clientY, host: { ...h, kind: 'ssh' } })
                          }}
                        >
                          <IconServer size={14} className="mock-icon" />
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

            {dockerHosts.length > 0 && (
              <section className="sidebar-section">
                <div className="sidebar-header">
                  <span>{t('terminal.dockerHosts')}</span>
                  {dockerHosts.some((h) => h.running === false) && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-ghost wn-btn-sm"
                      title={t('terminal.pruneStopped')}
                      {...pressProps(() => {
                        void (async () => {
                          try {
                            const n = await api.pruneStoppedDockerHosts()
                            await refreshHosts()
                            setStatusMessage(
                              n > 0 ? t('terminal.prunedStopped', { count: n }) : t('terminal.pruneStoppedNone')
                            )
                          } catch (e) {
                            setStatusMessage((e as Error).message)
                          }
                        })()
                      })}
                    >
                      {t('terminal.pruneStopped')}
                    </button>
                  )}
                </div>
                <div className="sidebar-body">
                  <ul className="conn-list">
                    {dockerHosts.map((h) => {
                      const hostLine =
                        h.running === false
                          ? t('terminal.containerStopped')
                          : h.image || h.containerId?.slice(0, 12) || 'container'
                      return (
                        <li
                          key={h.id}
                          className={`conn-item ${hostItemActive(h.id) ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''} ${h.running === false ? 'stopped' : ''}`}
                          {...pressProps(() => void openRecentHostWindow(h))}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCtxMenu({ x: e.clientX, y: e.clientY, host: h })
                          }}
                        >
                          <IconDocker size={14} className="mock-icon" />
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
                </div>
              </section>
            )}

            <SSHForwardPanel hosts={sshHosts} onStatus={setStatusMessage} />
          </>
        }
      >

        <main className="app-main">
          <div className="editor-chrome">
            <div className="wn-tabs" ref={tabStripRef}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-tab-id={t.id}
                  className={`wn-tab wn-tab-terminal wn-tab-${t.kind} ${t.id === activeTabId ? 'active' : ''} ${t.connectState !== 'ready' ? `wn-tab-${t.connectState}` : ''}`}
                  {...pressProps(() => selectTab(t.id))}
                  onContextMenu={(e) => openTabContextMenu(e, t.id, setTabCtxMenu, setActiveTabId)}
                >
                  {t.kind === 'local' ? <IconLaptop size={12} /> : t.kind === 'docker' ? <IconDocker size={12} /> : <IconTerminal size={12} />}
                  <span className="tab-title">{t.title}</span>
                  {t.connectState === 'connecting' && <span className="tab-status-badge connecting" />}
                  {t.connectState === 'failed' && <span className="tab-status-badge failed">!</span>}
                  {countLeaves(t.layout) > 1 && (
                    <span className="tab-split-badge">{countLeaves(t.layout)}</span>
                  )}
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
          <div className="workspace terminal-workspace">
            {tabs.length === 0 && (
              <EmptyState
                className="terminal-connect-empty"
                style={{ backgroundColor: terminalBackground(terminalOpacity) }}
                title={t('terminal.emptyWorkspace')}
                hint={t('terminal.emptyWorkspaceHint')}
                actions={[
                  { label: t('terminal.localTerminal'), onPress: () => void connectLocal(), primary: true },
                  { label: t('terminal.addHost'), onPress: () => openHostModal() },
                ]}
              />
            )}
            {tabs.map((t) => (
              <div
                key={t.id}
                className="terminal-pane-wrap"
                style={{ display: t.id === activeTabId ? 'flex' : 'none' }}
              >
                {t.connectState === 'ready' ? (
                  <TerminalSplitView
                    layout={t.layout}
                    rootLayout={t.layout}
                    activePaneId={t.activePaneId}
                    tabActive={t.id === activeTabId}
                    opacity={terminalOpacity}
                    onSelectPane={(paneId) => updateTab(t.id, { activePaneId: paneId })}
                    onLayoutChange={(layout) => updateTab(t.id, { layout })}
                    onClosePane={(paneId) => closePaneInTab(t.id, paneId)}
                  />
                ) : (
                  <TerminalTabStatusPane
                    title={t.title}
                    status={t.connectState}
                    error={t.connectError}
                    onRetry={t.connectState === 'failed' ? () => void retryTabConnect(t.id) : undefined}
                    onEdit={
                      t.connectState === 'failed' && t.kind === 'ssh' && t.connectHost
                        ? () => {
                            const ssh = shellHostAsSSH(t.connectHost!)
                            if (ssh) openHostModal(ssh)
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </main>
      </ProductLayout>

      <SSHHostModal
        open={hostModalOpen}
        initial={editingHost}
        onClose={() => setHostModalOpen(false)}
        onSaved={refreshHosts}
      />

      {tabCtxMenu && (
        <TabContextMenu
          menu={tabCtxMenu}
          disableCloseOthers={tabs.length <= 1}
          onDismiss={() => setTabCtxMenu(null)}
          onReconnect={() => void reconnectTab(tabCtxMenu.tabId)}
          onClose={() => void closeTab(tabCtxMenu.tabId)}
          onCloseOthers={() => void closeOtherTabs(tabCtxMenu.tabId)}
          onCloseAll={() => void closeAllTabs()}
        />
      )}
      {ctxMenu && ctxMenu.host === 'local' && (
        <ContextMenu
          key={`host-local-${ctxMenu.x}-${ctxMenu.y}`}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClick={(e) => e.stopPropagation()}
          onDismiss={() => setCtxMenu(null)}
        >
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              void connectLocal()
            })}
          >
            {t('terminal.newSession')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              setLocalPortsOpen(true)
            })}
          >
            {t('localPort.title')}
          </button>
        </ContextMenu>
      )}
      {ctxMenu && ctxMenu.host !== 'local' && (
        <ContextMenu
          key={`host-${ctxMenu.host.id}-${ctxMenu.x}-${ctxMenu.y}`}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClick={(e) => e.stopPropagation()}
          onDismiss={() => setCtxMenu(null)}
        >
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
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
              const host = ctxMenu.host
              if (host === 'local') return
              setCtxMenu(null)
              void newHostConnection(host)
            })}
          >
            {t('terminal.newSession')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              setCtxMenu(null)
              setLocalPortsOpen(true)
            })}
          >
            {t('localPort.title')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
              setCtxMenu(null)
              openNotebook({ hostId: host.id }, 'terminal')
            })}
          >
            {t('terminal.ctxNotebook')}
          </button>
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                if (host === 'local') return
                setCtxMenu(null)
                openDockerContextFromHost({ hostId: host.id }, 'terminal')
              })}
            >
              {t('terminal.ctxDocker')}
            </button>
          )}
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
              setCtxMenu(null)
              openSftp({ hostId: host.id }, 'terminal')
            })}
          >
            {t('terminal.ctxSftp')}
          </button>
          {ctxMenu.host.kind === 'docker' && ctxMenu.host.contextId && ctxMenu.host.containerId && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                if (host === 'local' || host.kind !== 'docker') return
                setCtxMenu(null)
                openLogs(
                  {
                    sourceType: 'docker',
                    name: host.containerName || host.name,
                    dockerContextId: host.contextId,
                    containerId: host.containerId,
                    fetch: true,
                  },
                  'terminal',
                )
              })}
            >
              {t('terminal.ctxLogs')}
            </button>
          )}
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                if (host === 'local' || host.kind !== 'ssh') return
                setCtxMenu(null)
                openLogs(
                  {
                    sourceType: 'ssh_file',
                    name: host.name,
                    sshHostId: host.id,
                    fetch: false,
                  },
                  'terminal',
                )
              })}
            >
              {t('terminal.ctxLogs')}
            </button>
          )}
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                if (host === 'local' || host.kind !== 'ssh') return
                setCtxMenu(null)
                openSSHForward({ hostId: host.id, openNew: true }, 'terminal')
              })}
            >
              {t('terminal.ctxForward')}
            </button>
          )}
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item"
              {...pressProps(() => {
                const host = ctxMenu.host
                if (host === 'local') return
                const ssh = shellHostAsSSH(host)
                setCtxMenu(null)
                if (ssh) openHostModal(ssh)
              })}
            >
              {t('common.edit')}
            </button>
          )}
          <button
            type="button"
            className="wn-context-item danger"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
              deleteHost(host)
            })}
          >
            {ctxMenu.host.kind === 'docker' ? t('terminal.removeDockerHost') : t('common.delete')}
          </button>
        </ContextMenu>
      )}
      {trustDialog}
      <LocalPortsDialog
        open={localPortsOpen}
        onClose={() => setLocalPortsOpen(false)}
        onStatus={setStatusMessage}
      />
      <ConfirmDialog
        open={deleteHostConfirm != null}
        title={
          deleteHostConfirm?.kind === 'docker'
            ? t('terminal.removeDockerHost')
            : t('terminal.deleteHostTitle')
        }
        message={
          deleteHostConfirm
            ? deleteHostConfirm.kind === 'docker'
              ? t('terminal.removeDockerHostMsg', { name: deleteHostConfirm.name })
              : t('terminal.deleteHostMsg', { name: deleteHostConfirm.name })
            : undefined
        }
        confirmLabel={deleteHostConfirm?.kind === 'docker' ? t('terminal.removeDockerHost') : t('common.delete')}
        danger
        onConfirm={() => void confirmDeleteHost()}
        onCancel={() => setDeleteHostConfirm(null)}
      />
    </div>
  )
}

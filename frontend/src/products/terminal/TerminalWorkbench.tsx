import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShellHost, SSHHost } from '../../api/types'
import { shellHostAsSSH } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { EmptyState } from '../../components/EmptyState'
import {
  ProductLayout,
  rememberScalarSize,
  recallScalarSize,
  useResizable,
} from '../../components/layout'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import {
  IconDocker,
  IconLaptop,
  IconPlus,
  IconSplitClose,
  IconSplitHorizontal,
  IconSplitVertical,
  IconTerminal,
} from '../../components/Icons'
import { openAgentDraft, mentionSSH, mentionDockerHost } from '../../features/agent/openAgentDraft'
import { assetDragRowProps } from '../../features/agent/agentAssetDrag'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildTerminalSurface } from '../../stores/agentSurface'
import { openNotebook, openDockerContextFromHost, openSftp, openLogs, openBackup, openSSHForward, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadBool, payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { pressProps, useDismissOverlays } from '../../components/compat'
import {
  scheduleTerminalWorkspacePersist,
  toTerminalWorkspaceSnapshot,
} from '../../stores/terminalWorkspacePersist'
import { shellSingleQuote } from '../../features/terminal/frequentPaths'
import { SSHHostModal } from '../../features/terminal/SSHHostModal'
import { TerminalAddModal, type TerminalAddKind } from '../../features/terminal/TerminalAddModal'
import { useSSHTrustConfirm } from '../../features/terminal/useSSHTrustConfirm'
import { LocalPortsDialog } from '../../features/terminal/LocalPortsPanel'
import { SSHForwardPanel } from '../../features/terminal/SSHForwardPanel'
import { TerminalSplitView } from '../../features/terminal/TerminalSplitView'
import { TerminalTabStatusPane } from '../../features/terminal/TerminalTabStatusPane'
import { ECSMonitorBar } from '../../features/terminal/ECSMonitorBar'
import { focusTerminalSession } from '../../features/terminal/terminalFocus'
import { encodeTerminalInject, isSessionShellIdle } from '../../features/terminal/terminalClipboard'
import { pickAgentTerminalTab, type AgentTabDecision } from './pickAgentTerminalTab'
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

const TERMINAL_SIDE_TAB_KEY = 'terminal_sidebar_tab'
const TERMINAL_SIDEBAR_WIDTH_KEY = 'terminal_sidebar_width'
const TERMINAL_SIDEBAR_EXPANDED_KEY = 'terminal_sidebar_width__expanded'
const TERMINAL_SIDEBAR_COLLAPSED_KEY = 'terminal_sidebar__collapsed'
type TerminalSideTab = 'local' | 'ssh' | 'docker'

function loadTerminalSideTab(): TerminalSideTab {
  try {
    const v = localStorage.getItem(TERMINAL_SIDE_TAB_KEY)
    // 旧版「隧道」独立 tab 已并入 SSH
    if (v === 'forward') return 'ssh'
    if (v === 'local' || v === 'ssh' || v === 'docker') return v
  } catch {
    /* ignore */
  }
  return 'ssh'
}

function persistTerminalSideTab(tab: TerminalSideTab) {
  try {
    localStorage.setItem(TERMINAL_SIDE_TAB_KEY, tab)
  } catch {
    /* ignore */
  }
}

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
  /** 本机项目工作目录（绝对路径）；MCP 按此隔离标签 */
  workDir?: string
  /** 最近一次被激活（用于侧栏单击回到最近窗口） */
  focusedAt?: number
}

/** normalizeWorkDirKey 本机标签隔离键。 */
function normalizeWorkDirKey(workDir?: string): string {
  const s = (workDir || '').trim().replace(/\/+$/, '')
  if (!s) return ''
  return s
}

/** basenameWorkDir 取目录名作标签后缀。 */
function basenameWorkDir(workDir: string): string {
  const parts = normalizeWorkDirKey(workDir).split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || workDir
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
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalKind, setAddModalKind] = useState<TerminalAddKind>('ssh')
  const [sgSyncingHostId, setSgSyncingHostId] = useState('')
  const [localPortsOpen, setLocalPortsOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null)
  const [reconnectingTabId, setReconnectingTabId] = useState<string | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [sideTab, setSideTab] = useState<TerminalSideTab>(() => loadTerminalSideTab())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(TERMINAL_SIDEBAR_COLLAPSED_KEY) === '1',
  )
  const {
    size: terminalSidebarWidth,
    setSizeAndSave: setTerminalSidebarWidth,
    onResizeStart: onTerminalSidebarResizeStart,
  } = useResizable({
    axis: 'x',
    storageKey: TERMINAL_SIDEBAR_WIDTH_KEY,
    defaultSize: 220,
    min: 180,
    max: 480,
  })
  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(TERMINAL_SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      if (next) rememberScalarSize(TERMINAL_SIDEBAR_EXPANDED_KEY, terminalSidebarWidth)
      else {
        setTerminalSidebarWidth(
          recallScalarSize(TERMINAL_SIDEBAR_EXPANDED_KEY, terminalSidebarWidth, 180, 480),
        )
      }
      return next
    })
  }, [terminalSidebarWidth, setTerminalSidebarWidth])
  const [ctxMenu, setCtxMenu] = useState<
    { x: number; y: number; host: ShellHost | 'local' } | null
  >(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  const [deleteHostConfirm, setDeleteHostConfirm] = useState<ShellHost | null>(null)
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
    void refreshHosts()
  }, [refreshHosts])

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

  const syncHostSecurityGroup = async (hostId: string) => {
    const id = hostId.trim()
    if (!id || sgSyncingHostId) return
    setSgSyncingHostId(id)
    setStatusMessage(t('sshHost.sgSyncing'))
    try {
      const res = await api.syncSSHHostSecurityGroup(id)
      await refreshHosts()
      const cidr = res.cidr || res.publicIp || ''
      setStatusMessage(
        res.message?.trim()
          ? t('sshHost.sgSyncOk', { message: res.message })
          : t('sshHost.sgSyncManualOk', { cidr: cidr || 'ok' }),
      )
    } catch (e) {
      setStatusMessage(t('sshHost.sgSyncManualFail', { error: (e as Error).message }))
    } finally {
      setSgSyncingHostId('')
    }
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

  /** withOpenTimeout 避免本机/远程打开无限挂起，标签永久停在 connecting。 */
  const withOpenTimeout = async <T,>(
    p: Promise<T>,
    ms: number,
    timeoutMessage: string,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const createPendingTab = (opts: {
    hostId: string
    kind: 'local' | 'ssh' | 'docker'
    title: string
    host?: ShellHost
    workDir?: string
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
      workDir: opts.workDir ? normalizeWorkDirKey(opts.workDir) : undefined,
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

  /** writeInitialCommand 等到交互提示符后再写入。登录脚本期间不注入。成功 true。 */
  const writeInitialCommand = async (sessionId: string, command?: string): Promise<boolean> => {
    if (!command?.trim()) return true
    let ready = false
    try {
      ready = await api.waitTerminalPrompt(sessionId, 12_000)
    } catch {
      return false
    }
    if (!ready) return false
    const data = encodeTerminalInject(command)
    for (let i = 0; i < 3; i++) {
      try {
        await api.writeTerminal(sessionId, data)
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return false
  }

  /** injectIntoTab 向已有标签注入命令；写入失败则重连后再写一次。 */
  const injectIntoTab = async (tabId: string, initialCommand?: string) => {
    if (!initialCommand?.trim()) return
    const tab0 = tabsRef.current.find((t) => t.id === tabId)
    const sid0 = tab0 ? firstSessionId(tab0.layout) : ''
    if (sid0 && (await writeInitialCommand(sid0, initialCommand))) {
      setStatusMessage(t('terminal.cmdExecuted'))
      return
    }
    // 僵死会话：MCP 确认后常见——UI 仍显示 ready，但 write 失败
    setStatusMessage(t('terminal.reconnecting', { name: tab0?.title || '' }))
    await reconnectTab(tabId)
    const tab1 = tabsRef.current.find((t) => t.id === tabId)
    const sid1 = tab1 ? firstSessionId(tab1.layout) : ''
    if (sid1 && (await writeInitialCommand(sid1, initialCommand))) {
      setStatusMessage(t('terminal.cmdExecuted'))
      return
    }
    setStatusMessage(t('terminal.cmdInjectFailed'))
  }

  /** tabIdle 已连通且画面像停在提示符。无会话尾部时视为可注入。 */
  const tabIdle = (tab: TerminalTab): boolean => {
    if (tab.connectState !== 'ready') return false
    const sid = firstSessionId(tab.layout)
    if (!sid || !isLiveSessionId(sid)) return true
    return isSessionShellIdle(sid)
  }

  /** localPool 本机同一 workDir；无 workDir 时不抢占带 workDir 的标签。 */
  const localPool = (workDir?: string): TerminalTab[] => {
    const key = normalizeWorkDirKey(workDir)
    return tabsRef.current.filter((tab) => {
      if (tab.kind !== 'local') return false
      const tabKey = normalizeWorkDirKey(tab.workDir)
      return key ? tabKey === key : !tabKey
    })
  }

  /** hostPool 同一 SSH / Docker 主机的标签。 */
  const hostPool = (hostId: string): TerminalTab[] =>
    tabsRef.current.filter(
      (tab) => (tab.kind === 'ssh' || tab.kind === 'docker') && tab.hostId === hostId,
    )

  /** indexedTitle 同目标已有标签时加「 · N」。 */
  const indexedTitle = (baseTitle: string, count: number): string => {
    if (count <= 0) return baseTitle
    return `${baseTitle} · ${count + 1}`
  }

  /** applyAgentDecision 执行选标签结果。人单击侧栏不走这里。 */
  const applyAgentDecision = async (
    pool: TerminalTab[],
    decision: AgentTabDecision,
    initialCommand: string | undefined,
    spawn: () => Promise<void>,
  ) => {
    if (decision.action === 'spawn') {
      const busy = pool.find((tab) => tab.connectState === 'ready' && !tabIdle(tab))
      if (busy && initialCommand?.trim()) {
        setStatusMessage(t('terminal.busyNewTab', { title: busy.title }))
      }
      await spawn()
      return
    }
    const tab = pool.find((item) => item.id === decision.tabId)
    if (!tab) {
      await spawn()
      return
    }
    setActiveTabId(tab.id)
    setActiveProduct('terminal')
    if (decision.action === 'retry') {
      await retryTabConnect(tab.id)
    }
    if (decision.inject && initialCommand?.trim()) {
      await injectIntoTab(tab.id, initialCommand)
      return
    }
    if (decision.action === 'reuse') {
      setStatusMessage(t('terminal.connected', { title: tab.title }))
    }
  }

  /** runTerminalLink Agent 打开/聚焦终端。同一目标先复用最近聚焦且空闲的标签，都忙才新开。 */
  const runTerminalLink = async (
    hostId?: string,
    localShell?: boolean,
    initialCommand?: string,
    workDir?: string,
    displayName?: string,
  ) => {
    const inject = Boolean(initialCommand?.trim())
    if (localShell) {
      const key = normalizeWorkDirKey(workDir)
      const pool = localPool(key || undefined)
      const baseTitle =
        displayName?.trim() ||
        (key ? `本机 · ${basenameWorkDir(key)}` : t('terminal.localShellTitle'))
      const decision = pickAgentTerminalTab(
        pool.map((tab) => ({
          id: tab.id,
          connectState: tab.connectState,
          focusedAt: tab.focusedAt,
          idle: tabIdle(tab),
        })),
        inject,
      )
      await applyAgentDecision(pool, decision, initialCommand, () =>
        connectLocal(initialCommand, {
          workDir: key || undefined,
          title: indexedTitle(baseTitle, pool.length),
        }),
      )
      return
    }
    if (!hostId) return
    const pool = hostPool(hostId)
    const decision = pickAgentTerminalTab(
      pool.map((tab) => ({
        id: tab.id,
        connectState: tab.connectState,
        focusedAt: tab.focusedAt,
        idle: tabIdle(tab),
      })),
      inject,
    )
    await applyAgentDecision(pool, decision, initialCommand, async () => {
      let host = hosts.find((item) => item.id === hostId)
      if (!host) {
        host = await api.getShellHost(hostId)
        setHosts((prev) => (prev.some((item) => item.id === hostId) ? prev : [...prev, host!]))
      }
      const base = host.kind === 'docker' ? host.name : `${host.user}@${host.host}:${host.port || 22}`
      await connectHost(host, initialCommand, indexedTitle(base, pool.length))
    })
  }

  const connectLocal = async (
    initialCommand?: string,
    opts?: { workDir?: string; title?: string },
  ) => {
    const workDir = normalizeWorkDirKey(opts?.workDir)
    const title =
      opts?.title?.trim() ||
      (workDir ? `本机 · ${basenameWorkDir(workDir)}` : t('terminal.localShellTitle'))
    const tabId = createPendingTab({ hostId: '', kind: 'local', title, workDir: workDir || undefined })
    setStatusMessage(t('terminal.openingLocal'))
    try {
      const info = await withOpenTimeout(
        api.openLocalTerminal(120, 32),
        15_000,
        t('terminal.openLocalTimeout'),
      )
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      activateTab(tabId, { sessionId: info.sessionId, title })
      setStatusMessage(t('terminal.connected', { title }))
      let cmd = initialCommand
      if (workDir) {
        const cd = `cd ${shellSingleQuote(workDir)}\r`
        if (cmd?.trim()) {
          cmd = cd + (cmd.endsWith('\r') || cmd.endsWith('\n') ? cmd : `${cmd}\r`)
        } else {
          cmd = cd
        }
      }
      const wrote = await writeInitialCommand(info.sessionId, cmd)
      if (!wrote && cmd?.trim()) setStatusMessage(t('terminal.cmdInjectFailed'))
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
    if (host.kind !== 'docker' && host.sgSync) {
      setStatusMessage(t('sshHost.sgSyncing'))
    }
    const open = () => api.openTerminal(host.id, 120, 32)
    return host.kind === 'docker'
      ? open()
      : withSSHHostTrust(host.host || '', host.port || 22, open, confirmTrust)
  }

  const connectedStatus = (title: string, info: { reused?: boolean; dialMs?: number }) => {
    if (typeof info.dialMs !== 'number') return t('terminal.connected', { title })
    if (info.reused) return t('terminal.connectedHot', { title, ms: info.dialMs })
    return t('terminal.connectedCold', { title, ms: info.dialMs })
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

  const connectHost = async (host: ShellHost, initialCommand?: string, titleOverride?: string) => {
    if (host.kind === 'docker' && host.running === false) {
      setStatusMessage(t('terminal.containerStoppedHint', { name: host.name }))
      return
    }
    const title =
      titleOverride?.trim() ||
      (host.kind === 'docker' ? host.name : `${host.user}@${host.host}:${host.port || 22}`)
    const tabId = createPendingTab({
      hostId: host.id,
      kind: host.kind === 'docker' ? 'docker' : 'ssh',
      title,
      host,
    })
    setStatusMessage(t('terminal.connecting', { name: title }))
    try {
      const info = await withOpenTimeout(
        openRemoteSession(host),
        45_000,
        t('terminal.openRemoteTimeout'),
      )
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      activateTab(tabId, { sessionId: info.sessionId, title: info.title || title })
      setStatusMessage(connectedStatus(info.title || title, info))
      const wrote = await writeInitialCommand(info.sessionId, initialCommand)
      if (!wrote && initialCommand?.trim()) setStatusMessage(t('terminal.cmdInjectFailed'))
    } catch (e) {
      const message = (e as Error).message
      if (!tabsRef.current.some((t) => t.id === tabId)) return
      failTab(tabId, message)
      setStatusMessage(message)
    }
  }

  const retryTabConnect = async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    // connecting 卡住时也允许重试（否则永远停在转圈）
    if (!tab || (tab.connectState !== 'failed' && tab.connectState !== 'connecting')) return
    updateTab(tabId, { connectState: 'connecting', connectError: undefined })
    setActiveTabId(tabId)
    setStatusMessage(t('terminal.reconnecting', { name: tab.title }))
    try {
      if (tab.kind === 'local') {
        const info = await withOpenTimeout(
          api.openLocalTerminal(120, 32),
          15_000,
          t('terminal.openLocalTimeout'),
        )
        if (!tabsRef.current.some((t) => t.id === tabId)) return
        activateTab(tabId, { sessionId: info.sessionId, title: info.title || tab.title })
        setStatusMessage(t('terminal.connected', { title: tab.title }))
        if (tab.workDir) {
          await writeInitialCommand(info.sessionId, `cd ${shellSingleQuote(tab.workDir)}\r`)
        }
      } else {
        const host = tab.connectHost ?? (await resolveHost(tab.hostId))
        const info = await withOpenTimeout(
          openRemoteSession(host),
          45_000,
          t('terminal.openRemoteTimeout'),
        )
        if (!tabsRef.current.some((t) => t.id === tabId)) return
        activateTab(tabId, { sessionId: info.sessionId, title: info.title || tab.title })
        setStatusMessage(connectedStatus(info.title || tab.title, info))
      }
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
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                layout: newLayout,
                activePaneId: firstLeafId(newLayout),
                connectState: 'ready' as const,
                connectError: undefined,
              }
            : t,
        ),
      )
      setActiveTabId(tabId)
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

  /** ensureHostBook 静默成册：选中/连接 SSH 时确保记忆区/{主机}/ 存在，供笔记本聚焦与 Agent 注入。 */
  const ensureHostBook = (host: ShellHost) => {
    if (host.kind !== 'ssh' || !host.id) return
    void api
      .ensureHostMemoryBook(host.id)
      .then((book) => {
        useAppStore.getState().setNotebookFocusFolderId(book.dirRel)
      })
      .catch(() => {
        /* 成册失败不挡连接 */
      })
  }

  /** openRecentHostWindow 单击：回到该主机最近窗口；没有则新建连接。 */
  const openRecentHostWindow = async (host: ShellHost) => {
    if (host.kind === 'docker' && host.running === false) {
      setStatusMessage(t('terminal.containerStoppedHint', { name: host.name }))
      return
    }
    ensureHostBook(host)
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
    ensureHostBook(host)
    await connectHost(host)
  }

  useWorkbenchCommand(Capability.ShellRun, (cmd) => {
    const hostId = payloadStr(cmd.payload, 'hostId')
    const localShell = payloadBool(cmd.payload, 'localShell')
    const initialCommand = payloadStr(cmd.payload, 'initialCommand')
    const workDir = payloadStr(cmd.payload, 'workDir')
    const displayName = payloadStr(cmd.payload, 'name')
    void runTerminalLink(hostId, localShell, initialCommand, workDir, displayName).catch((e) => {
      setStatusMessage((e as Error).message)
    })
  })

  useWorkbenchCommand(Capability.SSHForwardOpen, () => {
    setSideTab('ssh')
    persistTerminalSideTab('ssh')
  })

  useWorkbenchCommand(Capability.TerminalReconnect, (cmd) => {
    const sessionId =
      payloadStr(cmd.payload, 'sessionId') || payloadStr(cmd.payload, 'terminalSessionId') || ''
    const hostId = payloadStr(cmd.payload, 'hostId') || ''
    const localShell = payloadBool(cmd.payload, 'localShell')
    const tabsNow = tabsRef.current

    let tab =
      (sessionId
        ? tabsNow.find((t) => collectSessionIds(t.layout).includes(sessionId))
        : undefined) ??
      (localShell
        ? tabsNow.find((t) => t.kind === 'local' && t.id === activeTabId) ||
          tabsNow.find((t) => t.kind === 'local')
        : undefined) ??
      (hostId
        ? tabsNow.find(
            (t) =>
              (t.kind === 'ssh' || t.kind === 'docker') &&
              t.hostId === hostId &&
              t.id === activeTabId,
          ) ||
          tabsNow.find((t) => (t.kind === 'ssh' || t.kind === 'docker') && t.hostId === hostId)
        : undefined)

    void (async () => {
      try {
        if (tab) {
          await reconnectTab(tab.id)
          return
        }
        if (localShell) {
          await connectLocal()
          return
        }
        if (hostId) {
          const host = await resolveHost(hostId)
          await connectHost(host)
          return
        }
        setStatusMessage(t('terminal.reconnectNoTarget'))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
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

  const openAddModal = (kind: TerminalAddKind = 'ssh') => {
    // pressProps 会传入事件对象；必须归一化，否则 kind 非法时表单整页空白
    const next: TerminalAddKind =
      kind === 'local' || kind === 'docker' || kind === 'ssh' ? kind : 'ssh'
    setAddModalKind(next)
    setSideTab(next)
    persistTerminalSideTab(next)
    setAddModalOpen(true)
  }

  return (
    <div className="product-workbench terminal-workbench">
      <div className="product-toolbar terminal-toolbar">
        <nav className="product-actions">
          <button
            type="button"
            className="terminal-toolbar-action"
            title={t('terminal.addKindTitle')}
            {...pressProps(() => openAddModal('ssh'))}
          >
            <IconPlus size={14} />
          </button>
          {activeTab?.connectState === 'ready' && (
            <>
              <button
                type="button"
                className="terminal-toolbar-action"
                title={t('terminal.splitRowTitle')}
                disabled={splitting || activePaneCount >= MAX_PANES}
                {...pressProps(() => splitActivePane('row'), {
                  disabled: splitting || activePaneCount >= MAX_PANES,
                })}
              >
                <IconSplitVertical size={14} />
              </button>
              <button
                type="button"
                className="terminal-toolbar-action"
                title={t('terminal.splitColTitle')}
                disabled={splitting || activePaneCount >= MAX_PANES}
                {...pressProps(() => splitActivePane('col'), {
                  disabled: splitting || activePaneCount >= MAX_PANES,
                })}
              >
                <IconSplitHorizontal size={14} />
              </button>
              <button
                type="button"
                className="terminal-toolbar-action"
                title={t('terminal.closeSplitTitle')}
                disabled={activePaneCount <= 1}
                {...pressProps(closeActivePane, { disabled: activePaneCount <= 1 })}
              >
                <IconSplitClose size={14} />
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
        storageKey={TERMINAL_SIDEBAR_WIDTH_KEY}
        resizeTitle={`${t('common.resizeWidth')} · ${t('common.collapsePane')}`}
        defaultWidth={220}
        minWidth={180}
        maxWidth={480}
        width={terminalSidebarWidth}
        onResizeStart={onTerminalSidebarResizeStart}
        sidebarClassName="terminal-sidebar"
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebarCollapse={toggleSidebarCollapse}
        sidebarRailLabel={t('terminal.sidebarRail')}
        sidebarExpandTitle={t('terminal.expandSidebar')}
        sidebar={
          <div className="terminal-side">
            <div className="terminal-side-tabs-row">
              <div className="terminal-side-tabs" role="tablist" aria-label={t('terminal.sideTabs')}>
                {(
                  [
                    { id: 'local' as const, label: t('terminal.sideTabLocal') },
                    { id: 'ssh' as const, label: t('terminal.sideTabSSH') },
                    { id: 'docker' as const, label: t('terminal.sideTabDocker') },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={sideTab === tab.id}
                    className={`terminal-side-tab${sideTab === tab.id ? ' is-active' : ''}`}
                    {...pressProps(() => {
                      setSideTab(tab.id)
                      persistTerminalSideTab(tab.id)
                    })}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {sideTab === 'docker' && dockerHosts.some((h) => h.running === false) && (
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
                          n > 0 ? t('terminal.prunedStopped', { count: n }) : t('terminal.pruneStoppedNone'),
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

            {sideTab === 'local' && (
              <section className="sidebar-section terminal-side-panel">
                <div className="sidebar-body connections-body">
                  <ul className="conn-list is-homogeneous">
                    <li
                      className={`conn-item ${localItemActive() ? 'active' : ''} ${localTabCount > 0 ? 'connected' : ''}`}
                      {...pressProps(() => void openRecentLocalWindow())}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setCtxMenu({ x: e.clientX, y: e.clientY, host: 'local' })
                      }}
                    >
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
            )}

            {sideTab === 'ssh' && (
              <section className="sidebar-section terminal-side-panel">
                <div className="sidebar-body">
                  {sshHosts.length === 0 ? (
                    <EmptyState
                      variant="inline"
                      title={t('terminal.emptyHosts')}
                      actions={[{ label: t('terminal.addHost'), onPress: () => openAddModal('ssh'), primary: true }]}
                    />
                  ) : (
                    <ul className="conn-list is-homogeneous">
                      {sshHosts.map((h) => {
                        const hostLine = `${h.user}@${h.host}:${h.port}`
                        return (
                          <li
                            key={h.id}
                            className={`conn-item ${hostItemActive(h.id) ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''}`}
                            {...assetDragRowProps(mentionSSH(h), () => void openRecentHostWindow({ ...h, kind: 'ssh' }))}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setCtxMenu({ x: e.clientX, y: e.clientY, host: { ...h, kind: 'ssh' } })
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
              <section className="sidebar-section terminal-side-panel">
                <div className="sidebar-body">
                  {dockerHosts.length === 0 ? (
                    <EmptyState
                      variant="inline"
                      title={t('terminal.emptyDockerHosts')}
                      actions={[
                        { label: t('terminal.addDockerHost'), onPress: () => openAddModal('docker'), primary: true },
                      ]}
                    />
                  ) : (
                    <ul className="conn-list is-homogeneous">
                      {dockerHosts.map((h) => {
                        const hostLine =
                          h.running === false
                            ? t('terminal.containerStopped')
                            : h.image || h.containerId?.slice(0, 12) || 'container'
                        return (
                          <li
                            key={h.id}
                            className={`conn-item ${hostItemActive(h.id) ? 'active' : ''} ${connectedHostIds.has(h.id) ? 'connected' : ''} ${h.running === false ? 'stopped' : ''}`}
                            {...assetDragRowProps(mentionDockerHost(h), () => void openRecentHostWindow(h))}
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
        }
      >

        <main className="app-main terminal-main">
          <div className="editor-chrome terminal-editor-chrome">
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
                  { label: t('terminal.addHost'), onPress: () => openAddModal('ssh') },
                ]}
              />
            )}
            {tabs.map((t) => (
              <div
                key={t.id}
                className="terminal-pane-wrap"
                style={{ display: t.id === activeTabId ? 'flex' : 'none' }}
              >
                {(() => {
                  const bound = hosts.find((h) => h.id === t.hostId)
                  if (bound?.kind !== 'ssh' || !bound.cloudInstanceId) return null
                  return (
                    <ECSMonitorBar
                      hostId={bound.id}
                      active={t.id === activeTabId}
                      opacity={terminalOpacity}
                    />
                  )
                })()}
                {t.connectState === 'ready' ? (
                  <TerminalSplitView
                    layout={t.layout}
                    rootLayout={t.layout}
                    activePaneId={t.activePaneId}
                    tabActive={t.id === activeTabId && activeProduct === 'terminal'}
                    hostId={t.kind === 'local' ? '' : t.hostId}
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
                    hostKind={t.kind}
                    onRetry={
                      t.connectState === 'failed' || t.connectState === 'connecting'
                        ? () => void retryTabConnect(t.id)
                        : undefined
                    }
                    onEdit={
                      t.connectState === 'failed' && t.kind === 'ssh' && t.connectHost
                        ? () => {
                            const ssh = shellHostAsSSH(t.connectHost!)
                            if (ssh) openHostModal(ssh)
                          }
                        : undefined
                    }
                    onSyncSecurityGroup={
                      t.connectState === 'failed' &&
                      t.kind === 'ssh' &&
                      t.connectHost?.cloudInstanceId &&
                      t.connectHost?.cloudAccountId
                        ? () => void syncHostSecurityGroup(t.hostId || t.connectHost!.id)
                        : undefined
                    }
                    sgSyncing={
                      Boolean(sgSyncingHostId) &&
                      sgSyncingHostId === (t.hostId || t.connectHost?.id || '')
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </main>
      </ProductLayout>

      <TerminalAddModal
        open={addModalOpen}
        initialKind={addModalKind}
        onClose={() => setAddModalOpen(false)}
        onLocal={(dir) => {
          setSideTab('local')
          persistTerminalSideTab('local')
          void connectLocal(undefined, dir ? { workDir: dir } : undefined)
        }}
        onSSHSaved={() => {
          setSideTab('ssh')
          persistTerminalSideTab('ssh')
          void refreshHosts()
        }}
        onDockerAdded={(host) => {
          setSideTab('docker')
          persistTerminalSideTab('docker')
          void refreshHosts().then(() => void openRecentHostWindow(host))
        }}
      />
      {/* 右键/能力指令打开隧道弹窗；隧道配置入口在数据库连接，侧栏不单独陈列 */}
      <div className="ssh-forward-command-host" hidden aria-hidden>
        <SSHForwardPanel hosts={sshHosts} onStatus={setStatusMessage} />
      </div>
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
              void newHostConnection(host)
            })}
          >
            {t('terminal.newSession')}
          </button>
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
          <div className="wn-context-sep" />
          <div className="wn-context-submenu-label">{t('terminal.ctxOnHost')}</div>
          <button
            type="button"
            className="wn-context-item wn-context-item-indent"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
              setCtxMenu(null)
              openSftp({ hostId: host.id }, 'terminal')
            })}
          >
            {t('terminal.ctxSftp')}
          </button>
          <button
            type="button"
            className="wn-context-item wn-context-item-indent"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
              setCtxMenu(null)
              void (async () => {
                const tab =
                  tabs.find((x) => x.id === activeTabId && x.hostId === host.id && x.connectState === 'ready') ||
                  tabs.find((x) => x.hostId === host.id && x.connectState === 'ready')
                const findSession = (
                  node: NonNullable<typeof tab>['layout'],
                  paneId: string,
                ): string => {
                  if (node.kind === 'leaf') return node.paneId === paneId ? node.sessionId : ''
                  return findSession(node.first, paneId) || findSession(node.second, paneId)
                }
                const firstSession = (node: NonNullable<typeof tab>['layout']): string => {
                  if (node.kind === 'leaf') return node.sessionId
                  return firstSession(node.first) || firstSession(node.second)
                }
                let path = ''
                if (tab) {
                  const sid = findSession(tab.layout, tab.activePaneId) || firstSession(tab.layout)
                  if (sid) {
                    try {
                      path = (await api.probeTerminalCwd(sid)).path || ''
                    } catch {
                      /* fall through */
                    }
                  }
                }
                if (!path.startsWith('/')) {
                  setStatusMessage(t('terminal.backupNeedPath'))
                  return
                }
                const base = path.split('/').filter(Boolean).pop() || host.name
                openBackup(
                  {
                    create: true,
                    name: base,
                    kind: 'files',
                    path,
                    sshHostId: host.id,
                  },
                  'terminal',
                )
                setStatusMessage(t('terminal.backupDrafted', { path }))
              })()
            })}
          >
            {t('terminal.createBackupPolicy')}
          </button>
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item wn-context-item-indent"
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
          {ctxMenu.host.kind === 'docker' && ctxMenu.host.contextId && ctxMenu.host.containerId && (
            <button
              type="button"
              className="wn-context-item wn-context-item-indent"
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
              className="wn-context-item wn-context-item-indent"
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
          {ctxMenu.host.kind === 'ssh' && (
            <button
              type="button"
              className="wn-context-item wn-context-item-indent"
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
          <button
            type="button"
            className="wn-context-item wn-context-item-indent"
            {...pressProps(() => {
              const host = ctxMenu.host
              if (host === 'local') return
              setCtxMenu(null)
              openNotebook({ hostId: host.id }, 'terminal')
            })}
          >
            {t('terminal.ctxNotebook')}
          </button>
          <div className="wn-context-sep" />
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

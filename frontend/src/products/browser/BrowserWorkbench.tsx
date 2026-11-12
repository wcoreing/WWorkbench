import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { ModalPortal, backdropDismissProps, pressProps } from '../../components/compat'
import { ProductLayout } from '../../components/layout'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import type { Workflow, TaskRun, TaskStep } from '../../api/types'
import { Capability } from '../../workbench/capabilities'
import { useWorkbenchCommand } from '../../stores/productLink'
import { askConfirm } from '../../utils/askConfirm'
import { APP_SETTING_KEYS, saveAppSetting } from '../../stores/appPreferences'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { NotebookIDE, type NotebookIDEHandle } from '../../features/notebook/NotebookIDE'
import { skillDirFromNoteId } from '../../features/notebook/notebookTree'
import { openAgentDraft } from '../../features/agent/openAgentDraft'
import './browser.css'

type BrowserStatus = {
  listening: boolean
  addr: string
  extensionConnected: boolean
  attachedTabId?: number
  extDir: string
  extVersion?: string
  seedVersion?: string
  versionMismatch?: boolean
  capabilities?: string[]
  recording?: boolean
  recordingSession?: string
  lastError?: string
}

type BrowserTab = {
  tabId: number
  windowId?: number
  url: string
  title: string
  active?: boolean
  attached?: boolean
}

type SnapNode = { ref: string; role: string; name: string; tag?: string; type?: string; frame?: string }
type FrameInfo = { id: string; url: string; title?: string; sameOrigin?: boolean; root?: boolean }

function parseNodes(raw: unknown): {
  title: string
  url: string
  nodes: SnapNode[]
  truncated?: boolean
  frames: FrameInfo[]
  frame: string
} {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return {
    title: String(parsed?.title || ''),
    url: String(parsed?.url || ''),
    nodes: (parsed?.nodes ?? []) as SnapNode[],
    truncated: !!parsed?.truncated,
    frames: (parsed?.frames ?? []) as FrameInfo[],
    frame: String(parsed?.frame || '#f0'),
  }
}

/** BrowserWorkbench 浏览器舞台：附着标签、点选/填表操作真实网页。 */
export function BrowserWorkbench() {
  const { t } = useI18n()
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [pageMeta, setPageMeta] = useState({ title: '', url: '' })
  const [nodes, setNodes] = useState<SnapNode[]>([])
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [activeFrame, setActiveFrame] = useState('#f0')
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [taskSteps, setTaskSteps] = useState<TaskStep[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const notebookIdeRef = useRef<NotebookIDEHandle>(null)
  const [fillRef, setFillRef] = useState<string | null>(null)
  const [fillValue, setFillValue] = useState('')
  const [filter, setFilter] = useState('')
  const [shots, setShots] = useState<Array<{ id: string; dataUrl: string; path: string; at: number }>>([])
  const [shotFocusId, setShotFocusId] = useState<string | null>(null)
  const [clickMarkers, setClickMarkers] = useState<Array<{ x: number; y: number; label: string }>>([])
  const [mainPane, setMainPane] = useState<'page' | 'ledger'>('page')
  const [logScopeRoot, setLogScopeRoot] = useState('')
  const [logNoteId, setLogNoteId] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set())
  const [editingRunId, setEditingRunId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [recording, setRecording] = useState(false)
  /** 执行过程逐步询问；默认关，MCP click/fill 等不弹窗。 */
  const [askConfirmSteps, setAskConfirmSteps] = useState(false)
  const wasConnected = useRef(false)
  const renameSkipBlur = useRef(false)
  const activeRunIdRef = useRef<string | null>(null)
  activeRunIdRef.current = activeRunId

  const annotateShot = useCallback(
    async (
      dataUrl: string,
      viewport: { width: number; height: number } | undefined,
      markers: Array<{ x: number; y: number; label: string }>,
    ) => {
      if (!markers.length || !viewport?.width || !viewport?.height) return dataUrl
      return await new Promise<string>((resolve) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(dataUrl)
            return
          }
          ctx.drawImage(img, 0, 0)
          const sx = img.naturalWidth / viewport.width
          const sy = img.naturalHeight / viewport.height
          markers.forEach((m, i) => {
            const x = m.x * sx
            const y = m.y * sy
            ctx.beginPath()
            ctx.arc(x, y, 14, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(255,77,79,0.35)'
            ctx.fill()
            ctx.lineWidth = 3
            ctx.strokeStyle = '#ff4d4f'
            ctx.stroke()
            ctx.fillStyle = '#ff4d4f'
            ctx.font = 'bold 18px sans-serif'
            ctx.fillText(String(i + 1), x + 16, y - 10)
          })
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = () => resolve(dataUrl)
        img.src = dataUrl
      })
    },
    [],
  )

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} · ${line}`, ...prev].slice(0, 40))
  }, [])

  /** 左栏只展示产品会话；试跑产生的 source=replay 不进列表。 */
  const visibleTaskRuns = (runs: TaskRun[]) => runs.filter((r) => r.source !== 'replay')

  /** 刷新会话列表；默认保留当前选中，绝不强行跳到第一条。 */
  const refreshTaskRuns = useCallback(async (preferRunId?: string | null) => {
    try {
      const runs = visibleTaskRuns(await api.listTaskRuns('', 40))
      setTaskRuns(runs)
      const want =
        preferRunId && runs.some((r) => r.id === preferRunId)
          ? preferRunId
          : activeRunIdRef.current && runs.some((r) => r.id === activeRunIdRef.current)
            ? activeRunIdRef.current
            : null
      // 仅首次（尚无选中）才默认第一条
      const pick = want || (!activeRunIdRef.current ? runs[0]?.id || null : null)
      if (pick !== activeRunIdRef.current) {
        setActiveRunId(pick)
      }
      if (pick) {
        const detail = await api.getTaskRun(pick)
        setTaskSteps(detail.steps || [])
      } else if (!activeRunIdRef.current) {
        setTaskSteps([])
      }
    } catch {
      /* 舞台可离线浏览 */
    }
  }, [])

  useEffect(() => {
    void api
      .listAppSettings()
      .then((settings) => {
        const v = String(settings[APP_SETTING_KEYS.browserAskConfirm] || '')
          .trim()
          .toLowerCase()
        setAskConfirmSteps(v === '1' || v === 'true' || v === 'yes' || v === 'on')
      })
      .catch(() => undefined)
  }, [])

  const toggleAskConfirmSteps = useCallback(() => {
    setAskConfirmSteps((prev) => {
      const next = !prev
      void saveAppSetting(APP_SETTING_KEYS.browserAskConfirm, next ? '1' : '0')
      setStatusMessage(next ? t('browser.askConfirmEnabled') : t('browser.askConfirmDisabled'))
      return next
    })
  }, [setStatusMessage, t])

  /** 清理历史误建的 replay 会话 + 卡死的 workflow running。 */
  const reapStaleRuns = useCallback(async () => {
    try {
      const runs = await api.listTaskRuns('', 40)
      const stale = runs.filter(
        (r) =>
          r.source === 'replay' ||
          (r.status === 'running' && r.source === 'workflow'),
      )
      if (!stale.length) return
      await api.deleteTaskRuns(stale.map((r) => r.id)).catch(() => undefined)
      await refreshTaskRuns(activeRunIdRef.current)
    } catch {
      /* ignore */
    }
  }, [refreshTaskRuns])

  const refreshWorkflows = useCallback(async () => {
    try {
      setWorkflows(await api.listWorkflows(30))
    } catch {
      /* ignore */
    }
  }, [])

  /**
   * 更新技能：同步 log、打开 SKILL.md，打开侧栏 Agent 并自动发送收口提示。
   * 不机械写 Skill；由侧栏 Agent 推理后 update_skill。
   */
  const updateActiveSkill = async () => {
    if (!activeRunId) {
      setStatusMessage(t('browser.ledgerPickRun'))
      return
    }
    setMainPane('ledger')
    setBusy(true)
    try {
      const synced = await syncRunLog(activeRunId, { open: false })
      const run = taskRuns.find((r) => r.id === activeRunId)
      const skillName =
        (activeSkill?.name || '').trim() ||
        (synced.skillName || '').trim() ||
        (synced.scopeRoot || '').split('/').filter(Boolean).pop() ||
        (run?.title || '').trim()
      const scope =
        (synced.scopeRoot || '').trim() ||
        (skillName ? `工作流/${skillName}` : '')
      const logPath = (synced.noteId || '').trim() || (scope ? `${scope}/log.md` : '')
      const title = (run?.title || skillName || activeRunId).trim()
      const skillNoteId = skillName ? `工作流/${skillName}/SKILL.md` : ''
      if (skillNoteId) {
        await notebookIdeRef.current?.openNote(skillNoteId)
      }
      useAppStore.getState().setAgentSurface({
        focusKind: 'task.skill',
        focusLabel: skillName || title,
        noteId: skillNoteId || logPath,
        tabTitle: title,
        selectionBrief: [
          skillName ? `skill=${skillName}` : '',
          skillNoteId ? `skillNote=${skillNoteId}` : '',
          logPath ? `log=${logPath}` : '',
          `runId=${activeRunId}`,
          'action=update_skill',
        ]
          .filter(Boolean)
          .join(' · '),
      })
      const prompt = t('browser.updateSkillAgentPrompt', {
        name: skillName || title,
        log: logPath || '工作流/{任务}/log.md',
        runId: activeRunId,
        title,
      })
      openAgentDraft({ mentions: [], message: prompt, autoSend: true, mode: 'agent' })
      setStatusMessage(t('browser.updateSkillAgentReady', { name: skillName || title }))
      pushLog(`update_skill → agent · ${skillName || title} · focus=${skillNoteId || logPath}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runSavedWorkflow = async (name: string) => {
    setBusy(true)
    try {
      const r = await api.runWorkflow(name)
      setStatusMessage(r.coach || r.note || t('browser.workflowRun') + ' · ' + name)
      pushLog(
        `run_workflow ${name} · ${r.paused ? 'pause' : 'done'} · ${r.executed?.length ?? r.total ?? 0} steps`,
      )
      void refreshTaskRuns()
      if (status?.attachedTabId != null) {
        try {
          await takeSnapshot(activeFrame)
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const syncRunLog = useCallback(async (runId: string, opts?: { open?: boolean }) => {
    const synced = await api.syncTaskRunLog(runId)
    const scope = (synced.scopeRoot || '').trim()
    const noteId = (synced.noteId || '').trim()
    if (scope) setLogScopeRoot(scope)
    if (noteId) setLogNoteId(noteId)
    await notebookIdeRef.current?.refresh()
    // 默认打开 log（选日志时看探索轨迹）；更新技能时传 open:false，改开 SKILL.md
    if (opts?.open !== false && noteId) await notebookIdeRef.current?.openNote(noteId)
    return synced
  }, [])

  const selectTaskRun = useCallback(async (runId: string) => {
    setActiveRunId(runId)
    try {
      const detail = await api.getTaskRun(runId)
      setTaskSteps(detail.steps || [])
      await syncRunLog(runId)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }, [setStatusMessage, syncRunLog])

  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedRunIds(new Set())
  }, [])

  const toggleRunSelected = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }, [])

  const selectAllRuns = useCallback(() => {
    setSelectedRunIds(new Set(taskRuns.map((r) => r.id)))
  }, [taskRuns])

  const beginRenameRun = useCallback((run: TaskRun) => {
    setEditingRunId(run.id)
    setEditTitle((run.title || run.session || '').trim())
  }, [])

  const cancelRenameRun = useCallback(() => {
    renameSkipBlur.current = true
    setEditingRunId(null)
    setEditTitle('')
  }, [])

  const commitRenameRun = useCallback(async () => {
    if (!editingRunId) return
    if (renameSkipBlur.current) {
      renameSkipBlur.current = false
      return
    }
    const title = editTitle.trim()
    if (!title) {
      setStatusMessage(t('browser.runRenameEmpty'))
      return
    }
    const runId = editingRunId
    setBusy(true)
    try {
      await api.renameTaskRun(runId, title)
      setTaskRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, title } : r)))
      setStatusMessage(t('browser.runRenamed', { title }))
      setEditingRunId(null)
      setEditTitle('')
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [editTitle, editingRunId, setStatusMessage, t])

  const deleteSelectedRuns = useCallback(async () => {
    const ids = [...selectedRunIds]
    if (ids.length === 0) {
      setStatusMessage(t('browser.runBatchNone'))
      return
    }
    const ok = await askConfirm({
      title: t('browser.runBatchDeleteTitle'),
      message: t('browser.runBatchDeleteMsg', { count: ids.length }),
      confirmLabel: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const n = await api.deleteTaskRuns(ids)
      const gone = new Set(ids)
      setTaskRuns((prev) => prev.filter((r) => !gone.has(r.id)))
      setSelectedRunIds(new Set())
      if (activeRunId && gone.has(activeRunId)) {
        setActiveRunId(null)
        setTaskSteps([])
        setLogScopeRoot('')
        setLogNoteId('')
      }
      if (editingRunId && gone.has(editingRunId)) cancelRenameRun()
      setStatusMessage(t('browser.runBatchDeleted', { count: n }))
      if (ids.length === taskRuns.length) exitBatchMode()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [
    activeRunId,
    cancelRenameRun,
    editingRunId,
    exitBatchMode,
    selectedRunIds,
    setStatusMessage,
    t,
    taskRuns.length,
  ])

  const switchMainPane = useCallback(
    (pane: 'page' | 'ledger') => {
      setMainPane(pane)
      if (pane !== 'ledger') {
        exitBatchMode()
        cancelRenameRun()
      }
    },
    [cancelRenameRun, exitBatchMode],
  )

  const refreshStatus = useCallback(async () => {
    try {
      const st = (await api.getBrowserStatus()) as BrowserStatus
      setStatus(st)
      setRecording(!!st.recording)
      return st
    } catch (e) {
      setStatusMessage((e as Error).message)
      return null
    }
  }, [setStatusMessage])

  const toggleRecording = useCallback(async () => {
    setBusy(true)
    try {
      if (recording) {
        await api.stopBrowserRecording()
        setRecording(false)
        setStatusMessage(t('browser.recordStopped'))
        switchMainPane('ledger')
        await refreshTaskRuns(activeRunId)
      } else {
        const r = await api.startBrowserRecording(pageMeta.title || '')
        setRecording(true)
        setStatusMessage(t('browser.recordStarted'))
        switchMainPane('ledger')
        if (r.taskRunId) {
          setActiveRunId(r.taskRunId)
          await refreshTaskRuns(r.taskRunId)
        } else {
          await refreshTaskRuns()
        }
      }
      void refreshStatus()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [
    activeRunId,
    pageMeta.title,
    recording,
    refreshStatus,
    refreshTaskRuns,
    setStatusMessage,
    switchMainPane,
    t,
  ])

  const refreshTabs = useCallback(async () => {
    setBusy(true)
    try {
      const raw = await api.listBrowserTabs()
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      const list = (parsed?.tabs ?? []) as BrowserTab[]
      setTabs(list)
      pushLog(t('browser.logListed', { count: list.length }))
      return list
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
      return [] as BrowserTab[]
    } finally {
      setBusy(false)
    }
  }, [pushLog, setStatusMessage, t])

  const applySnapshot = useCallback(
    (raw: unknown) => {
      const snap = parseNodes(raw)
      setPageMeta({ title: snap.title, url: snap.url })
      setNodes(snap.nodes)
      setFrames(snap.frames)
      if (snap.frame) setActiveFrame(snap.frame)
      setTruncated(!!snap.truncated)
      pushLog(t('browser.logSnapshot', { count: snap.nodes.length }))
      setStatusMessage(t('browser.snapshotDone', { count: snap.nodes.length }))
    },
    [pushLog, setStatusMessage, t],
  )

  const takeSnapshot = useCallback(async (frame?: string) => {
    setBusy(true)
    try {
      applySnapshot(await api.browserSnapshot(200, frame || activeFrame || ''))
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [activeFrame, applySnapshot, pushLog, setStatusMessage])

  const attach = async (tabId: number) => {
    setBusy(true)
    try {
      await api.attachBrowserTab(tabId)
      await refreshStatus()
      await refreshTabs()
      pushLog(t('browser.logAttached', { id: tabId }))
      setStatusMessage(t('browser.attachedHint'))
      setBusy(false)
      await takeSnapshot()
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
      setBusy(false)
    }
  }

  const clickNode = async (ref: string, name: string) => {
    // 不用 window.confirm：Wails/WebView 里经常不弹或直接 false，表现为「点了没用」
    setBusy(true)
    try {
      const raw = (await api.browserClick(ref, '', 'auto', activeFrame)) as {
        mode?: string
        x?: number
        y?: number
        text?: string
      }
      const mode = String(raw?.mode || 'auto')
      if (typeof raw?.x === 'number' && typeof raw?.y === 'number') {
        setClickMarkers((prev) =>
          [...prev, { x: raw.x as number, y: raw.y as number, label: name || ref }].slice(-8),
        )
      }
      setFilter('')
      pushLog(t('browser.logClick', { ref, name }) + ` · ${mode}`)
      setStatusMessage(t('browser.clickedLookChrome', { name: name || ref }))
      try {
        await api.browserWait({ nameIncludes: '确定', timeoutMs: 2200, frame: activeFrame })
      } catch {
        try {
          await api.browserWait({ nameIncludes: '保存', timeoutMs: 800, frame: activeFrame })
        } catch {
          await new Promise((r) => setTimeout(r, 350))
        }
      }
      await takeSnapshot(activeFrame)
      void refreshTaskRuns(activeRunId)
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
      void refreshTaskRuns(activeRunId)
    } finally {
      setBusy(false)
    }
  }

  const submitFill = async () => {
    if (!fillRef) return
    setBusy(true)
    try {
      await api.browserFill(fillRef, fillValue, '', activeFrame)
      pushLog(t('browser.logFill', { ref: fillRef }))
      setStatusMessage(t('browser.filled', { ref: fillRef }))
      setFillRef(null)
      setFillValue('')
      await takeSnapshot(activeFrame)
      void refreshTaskRuns(activeRunId)
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
      void refreshTaskRuns(activeRunId)
    } finally {
      setBusy(false)
    }
  }

  const takeScreenshot = async () => {
    setBusy(true)
    try {
      const r = await api.browserScreenshot('jpeg', 72)
      pushLog(t('browser.logScreenshot', { path: r.path }))
      setStatusMessage(t('browser.screenshotDone', { path: r.path }))
      if (r.dataUrl) {
        const marked = await annotateShot(r.dataUrl, r.viewport, clickMarkers)
        const item = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl: marked,
          path: r.path,
          at: Date.now(),
        }
        setShots((prev) => [item, ...prev].slice(0, 16))
        setShotFocusId(null)
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const focusedShot = useMemo(
    () => (shotFocusId ? shots.find((s) => s.id === shotFocusId) || null : null),
    [shotFocusId, shots],
  )

  useEffect(() => {
    if (!shotFocusId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShotFocusId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shotFocusId])

  const openCrossFrame = async (frameId: string) => {
    setBusy(true)
    try {
      const raw = (await api.browserOpenFrame(frameId, true)) as {
        opened?: boolean
        tabId?: number
        note?: string
        sameOrigin?: boolean
      }
      if (raw.opened && raw.tabId) {
        pushLog(t('browser.logOpenFrame', { frame: frameId, id: raw.tabId }))
        setStatusMessage(t('browser.openFrameDone'))
        setClickMarkers([])
        await refreshStatus()
        await refreshTabs()
        await takeSnapshot('#f0')
      } else {
        setStatusMessage(raw.note || t('browser.openFrameSame'))
        setActiveFrame(frameId)
        await takeSnapshot(frameId)
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
      pushLog((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revealExt = async () => {
    try {
      const r = await api.revealBrowserExtDir()
      setStatusMessage(t('browser.extOpened', { path: r.path }))
      pushLog(t('browser.logReveal', { path: r.path }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const openExtManage = async () => {
    try {
      const r = await api.openChromeExtensionsPage()
      setStatusMessage(r.hint || t('browser.reloadExtHint'))
      pushLog(t('browser.logOpenExtManage'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  useEffect(() => {
    void refreshStatus()
    void refreshTaskRuns()
    void refreshWorkflows()
    void reapStaleRuns()
    const id = window.setInterval(() => {
      void refreshStatus()
    }, 3000)
    const taskId = window.setInterval(() => {
      // 用 ref，避免闭包把选中打回列表第一条
      void refreshTaskRuns(activeRunIdRef.current)
    }, recording ? 2000 : 5000)
    return () => {
      window.clearInterval(id)
      window.clearInterval(taskId)
    }
  }, [refreshStatus, refreshTaskRuns, refreshWorkflows, reapStaleRuns, recording])

  useEffect(() => {
    const unsub = EventsOn('browser:recording', (raw: Record<string, unknown>) => {
      const on = !!raw?.recording
      setRecording(on)
      const runId = typeof raw?.taskRunId === 'string' ? raw.taskRunId : ''
      if (runId) {
        setActiveRunId(runId)
        void refreshTaskRuns(runId)
      } else {
        void refreshTaskRuns(activeRunIdRef.current)
      }
      if (on) switchMainPane('ledger')
    })
    return () => {
      unsub?.()
    }
  }, [refreshTaskRuns, switchMainPane])

  useEffect(() => {
    const connected = !!status?.extensionConnected
    if (connected && !wasConnected.current) {
      wasConnected.current = true
      setStatusMessage(t('browser.justConnected'))
      void refreshTabs()
    }
    if (!connected) wasConnected.current = false
  }, [status?.extensionConnected, refreshTabs, setStatusMessage, t])

  useWorkbenchCommand(Capability.BrowserOpen, (cmd) => {
    const label = String(cmd.payload?.stageLabel ?? '')
    if (label) setStatusMessage(label)
    else setStatusMessage(t('browser.opened'))
    void refreshStatus()
    void refreshTaskRuns(activeRunId)
  })

  const taskStatusLabel = (run: TaskRun) => {
    if (run.status === 'running') {
      if (run.source === 'replay') return t('browser.taskStatusReplaying')
      if (run.source === 'workflow') return t('browser.taskStatusRunningSkill')
      if (run.source === 'record') return t('browser.taskStatusRecording')
      return t('browser.taskStatusRunning')
    }
    switch (run.status) {
      case 'done':
        return t('browser.taskStatusDone')
      case 'failed':
        return t('browser.taskStatusFailed')
      case 'cancelled':
        return t('browser.taskStatusCancelled')
      default:
        return run.status
    }
  }

  const activeRun = useMemo(
    () => (activeRunId ? taskRuns.find((r) => r.id === activeRunId) || null : taskRuns[0] || null),
    [activeRunId, taskRuns],
  )

  /** 会话 id → 已生成的工作流/Skill（sourceRunId 关联） */
  const skillByRunId = useMemo(() => {
    const m = new Map<string, Workflow>()
    for (const pb of workflows) {
      const rid = pb.sourceRunId?.trim()
      if (rid) m.set(rid, pb)
    }
    return m
  }, [workflows])

  const activeSkill = useMemo(
    () => (activeRunId ? skillByRunId.get(activeRunId) || null : null),
    [activeRunId, skillByRunId],
  )

  /** 当前任务目录：同步 log 后的 scope 优先，否则按关联 Skill / 标题兜底。 */
  const activeSkillRootId = useMemo(() => {
    if (logScopeRoot) return logScopeRoot
    if (activeSkill) {
      const fromNote = skillDirFromNoteId(activeSkill.noteId || '')
      if (fromNote) return fromNote
      if (activeSkill.name) return `工作流/${activeSkill.name}`
    }
    const title = (activeRun?.title || '').trim()
    return title ? `工作流/${title}` : ''
  }, [logScopeRoot, activeSkill, activeRun])

  const preferredLogNoteId = useMemo(() => {
    if (logNoteId) return logNoteId
    return activeSkillRootId ? `${activeSkillRootId}/log.md` : ''
  }, [logNoteId, activeSkillRootId])

  useEffect(() => {
    if (!activeRunId) {
      setLogScopeRoot('')
      setLogNoteId('')
    }
  }, [activeRunId])

  const selectTaskRunAndReseed = useCallback(
    async (runId: string) => {
      await selectTaskRun(runId)
    },
    [selectTaskRun],
  )

  const connected = !!status?.extensionConnected
  const attached = status?.attachedTabId != null
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter(
      (n) =>
        n.ref.toLowerCase().includes(q) ||
        n.name.toLowerCase().includes(q) ||
        n.role.toLowerCase().includes(q),
    )
  }, [nodes, filter])

  const isFillable = (n: SnapNode) =>
    n.role === 'textbox' ||
    n.role === 'searchbox' ||
    n.role === 'combobox' ||
    n.role === 'text' ||
    n.role === 'spinbutton' ||
    n.tag === 'input' ||
    n.tag === 'textarea' ||
    n.type === 'text' ||
    n.type === 'search' ||
    n.type === 'email' ||
    n.type === 'password' ||
    n.type === 'number'

  const ledgerStepCount = activeRun?.stepCount ?? taskSteps.length

  return (
    <div className="browser-workbench is-stage">
      {status?.versionMismatch && (
        <div className="browser-mismatch">
          <p>{t('browser.versionMismatch', { running: status.extVersion || '?', seed: status.seedVersion || '?' })}</p>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={() => void openExtManage()}>
            {t('browser.reloadExtBtn')}
          </button>
        </div>
      )}

      {!connected && (
        <section className="browser-install">
          <div className="browser-install-copy">
            <strong>{t('browser.installTitle')}</strong>
            <span>{t('browser.installShort')}</span>
          </div>
          <code className="browser-ext-path">{status?.extDir || '—'}</code>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" {...pressProps(() => void revealExt())}>
            {t('browser.openExtDir')}
          </button>
        </section>
      )}

      <div className="browser-top-tabs" role="tablist" aria-label={t('browser.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={mainPane === 'page'}
          className={`browser-top-tab${mainPane === 'page' ? ' is-active' : ''}`}
          {...pressProps(() => switchMainPane('page'))}
        >
          {t('browser.navPage')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainPane === 'ledger'}
          className={`browser-top-tab${mainPane === 'ledger' ? ' is-active' : ''}`}
          {...pressProps(() => switchMainPane('ledger'))}
        >
          {t('browser.navLedger')}
          {ledgerStepCount > 0 ? ` · ${ledgerStepCount}` : ''}
        </button>
        <div className="browser-top-tabs-spacer" />
        <button
          type="button"
          className={`wn-btn wn-btn-sm browser-ask-btn${askConfirmSteps ? ' is-on wn-btn-primary' : ' wn-btn-ghost'}`}
          aria-pressed={askConfirmSteps}
          title={askConfirmSteps ? t('browser.askConfirmOn') : t('browser.askConfirmOff')}
          {...pressProps(() => toggleAskConfirmSteps())}
        >
          {t('browser.askConfirm')}
        </button>
        <button
          type="button"
          className={`wn-btn wn-btn-sm${recording ? ' wn-btn-danger' : ' wn-btn-primary'} browser-record-btn`}
          disabled={busy || !connected}
          title={recording ? t('browser.recordStopHint') : t('browser.recordStartHint')}
          {...pressProps(() => void toggleRecording())}
        >
          {recording ? t('browser.recordStop') : t('browser.recordStart')}
        </button>
      </div>

      <ProductLayout
        storageKey="browser_sidebar_width"
        defaultWidth={220}
        minWidth={160}
        maxWidth={360}
        resizeTitle={t('common.resizeWidth')}
        sidebarClassName="browser-sidebar"
        sidebar={
          <section className="sidebar-section browser-side-panel">
            <div className="sidebar-header">
              <span className="sidebar-header-title">
                {mainPane === 'page' ? t('browser.tabs') : t('browser.colSession')}
              </span>
              <div className="browser-sidebar-header-actions">
                {mainPane === 'page' ? (
                  <button
                    type="button"
                    className="wn-btn wn-btn-xs wn-btn-ghost"
                    disabled={busy || !connected}
                    {...pressProps(() => void refreshTabs())}
                  >
                    {t('browser.refreshTabs')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`wn-btn wn-btn-xs${batchMode ? ' wn-btn-primary' : ' wn-btn-ghost'}`}
                      disabled={busy || taskRuns.length === 0}
                      {...pressProps(() => {
                        if (batchMode) exitBatchMode()
                        else {
                          cancelRenameRun()
                          setBatchMode(true)
                        }
                      })}
                    >
                      {batchMode ? t('browser.runManageDone') : t('browser.runManage')}
                    </button>
                    <button
                      type="button"
                      className="wn-btn wn-btn-xs wn-btn-ghost"
                      disabled={busy}
                      {...pressProps(() => void refreshTaskRuns())}
                    >
                      {t('browser.taskRefresh')}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className={`sidebar-body${batchMode && mainPane === 'ledger' ? ' is-batching' : ''}`}>
              {mainPane === 'page' ? (
                <ul className="conn-list is-homogeneous">
                  {tabs.length === 0 ? (
                    <li className="conn-item is-empty">
                      <div className="conn-meta">
                        <span className="conn-host">
                          {!connected ? t('browser.tabsEmpty') : t('browser.tabsEmptyConnected')}
                        </span>
                      </div>
                    </li>
                  ) : (
                    tabs.map((tab) => (
                      <li
                        key={tab.tabId}
                        className={`conn-item${tab.attached ? ' active connected' : ''}`}
                        {...pressProps(() => void attach(tab.tabId))}
                      >
                        <span className="conn-dot" />
                        <div className="conn-meta">
                          <span className="conn-name" title={tab.title || tab.url}>
                            {tab.title || tab.url}
                          </span>
                          <span className="conn-host" title={tab.url}>
                            {tab.url}
                          </span>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              ) : (
                <>
                  <ul className="conn-list is-homogeneous">
                    {taskRuns.length === 0 ? (
                      <li className="conn-item is-empty">
                        <div className="conn-meta">
                          <span className="conn-host">{t('browser.taskLogEmptyShort')}</span>
                          <button
                            type="button"
                            className="wn-btn wn-btn-xs wn-btn-ghost"
                            onClick={() => switchMainPane('page')}
                          >
                            {t('browser.ledgerGoPage')}
                          </button>
                        </div>
                      </li>
                    ) : (
                      taskRuns.slice(0, 40).map((run) => {
                        const skill = skillByRunId.get(run.id)
                        const checked = selectedRunIds.has(run.id)
                        const renaming = editingRunId === run.id
                        return (
                          <li
                            key={run.id}
                            className={`conn-item${
                              !batchMode && activeRunId === run.id ? ' active' : ''
                            }${skill ? ' connected' : ''}${batchMode && checked ? ' is-batch-selected' : ''}`}
                            onClick={() => {
                              if (renaming) return
                              if (batchMode) toggleRunSelected(run.id)
                              else void selectTaskRunAndReseed(run.id)
                            }}
                          >
                            {batchMode ? (
                              <input
                                type="checkbox"
                                className="browser-run-check"
                                checked={checked}
                                onChange={() => toggleRunSelected(run.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={t('browser.runSelect')}
                              />
                            ) : (
                              <span className="conn-dot" />
                            )}
                            <div className="conn-meta">
                              {renaming ? (
                                <input
                                  className="browser-run-rename"
                                  value={editTitle}
                                  autoFocus
                                  disabled={busy}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      void commitRenameRun()
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault()
                                      cancelRenameRun()
                                    }
                                  }}
                                  onBlur={() => {
                                    if (renameSkipBlur.current) {
                                      renameSkipBlur.current = false
                                      return
                                    }
                                    void commitRenameRun()
                                  }}
                                />
                              ) : (
                                <span
                                  className="conn-name"
                                  title={run.title || run.session || run.id}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation()
                                    if (!batchMode) beginRenameRun(run)
                                  }}
                                >
                                  {run.title || run.session || run.id.slice(0, 8)}
                                </span>
                              )}
                              <span className="conn-host">
                                {taskStatusLabel(run)} · {run.stepCount ?? 0}
                                {skill ? ` · /${skill.name}` : ''}
                              </span>
                            </div>
                            {!batchMode && !renaming ? (
                              <button
                                type="button"
                                className="browser-run-edit"
                                title={t('browser.runRename')}
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  beginRenameRun(run)
                                }}
                              >
                                ✎
                              </button>
                            ) : null}
                          </li>
                        )
                      })
                    )}
                  </ul>
                  {batchMode && taskRuns.length > 0 ? (
                    <div className="browser-run-batch-bar">
                      <button
                        type="button"
                        className="wn-btn wn-btn-xs wn-btn-ghost"
                        disabled={busy}
                        {...pressProps(selectAllRuns)}
                      >
                        {t('browser.runSelectAll')}
                      </button>
                      <button
                        type="button"
                        className="wn-btn wn-btn-xs wn-btn-ghost"
                        disabled={busy || selectedRunIds.size !== 1}
                        {...pressProps(() => {
                          const id = [...selectedRunIds][0]
                          const run = taskRuns.find((r) => r.id === id)
                          if (run) beginRenameRun(run)
                        })}
                      >
                        {t('browser.runRename')}
                      </button>
                      <button
                        type="button"
                        className="wn-btn wn-btn-xs wn-btn-danger"
                        disabled={busy || selectedRunIds.size === 0}
                        {...pressProps(() => void deleteSelectedRuns())}
                      >
                        {t('browser.runBatchDelete', { count: selectedRunIds.size || 0 })}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        }
      >
        <div className="browser-main">
          {mainPane === 'page' ? (
            <>
              <div className="product-toolbar browser-page-toolbar">
                <span className="product-toolbar-status" title={status?.lastError || undefined}>
                  <span className={`status-dot ${connected ? 'online' : 'error'}`} />
                  <span>
                    {connected ? t('browser.extOn') : t('browser.extOff')}
                    {status?.listening ? ` · ${status.addr}` : ` · ${t('browser.bridgeDown')}`}
                    {status?.extVersion ? ` · v${status.extVersion}` : ''}
                  </span>
                </span>
                <div className="browser-page-toolbar-actions">
                  <button
                    type="button"
                    className="wn-btn wn-btn-sm wn-btn-ghost"
                    disabled={busy || !connected || !attached}
                    {...pressProps(() => void takeScreenshot())}
                  >
                    {t('browser.screenshot')}
                  </button>
                  <button
                    type="button"
                    className="wn-btn wn-btn-sm wn-btn-ghost"
                    disabled={busy || !connected || !attached}
                    {...pressProps(() => void takeSnapshot())}
                  >
                    {t('browser.snapshot')}
                  </button>
                </div>
              </div>
              <section className="browser-chrome">
                <div className="browser-chrome-omnibox">
                <span className="browser-chrome-lock" aria-hidden>
                  {attached ? '●' : '○'}
                </span>
                <span className="browser-chrome-url" title={pageMeta.url || undefined}>
                  {pageMeta.url || (attached ? t('browser.attachedHint') : t('browser.snapshotEmpty'))}
                </span>
                {frames.length > 1 && (
                  <div className="browser-frames">
                    {frames.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`browser-frame-chip ${activeFrame === f.id ? 'is-on' : ''}`}
                        disabled={busy}
                        title={f.sameOrigin === false ? t('browser.frameCrossOrigin') : f.url}
                        onClick={() => {
                          if (f.sameOrigin === false) {
                            void openCrossFrame(f.id)
                            return
                          }
                          setActiveFrame(f.id)
                          void takeSnapshot(f.id)
                        }}
                      >
                        {f.id}
                        {f.root ? ' · main' : f.sameOrigin === false ? ' · ⇄' : ''}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="browser-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('browser.filterPh')}
                  disabled={!attached}
                />
              </div>

              <div className="browser-chrome-page">
                {fillRef && (
                  <div className="browser-fill-bar">
                    <span>
                      {t('browser.fillLabel')} <code>{fillRef}</code>
                    </span>
                    <input
                      className="browser-fill-input"
                      value={fillValue}
                      onChange={(e) => setFillValue(e.target.value)}
                      placeholder={t('browser.fillPh')}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="wn-btn wn-btn-sm wn-btn-primary"
                      disabled={busy}
                      {...pressProps(() => void submitFill())}
                    >
                      {t('browser.fillSubmit')}
                    </button>
                    <button
                      type="button"
                      className="wn-btn wn-btn-sm wn-btn-ghost"
                      disabled={busy}
                      {...pressProps(() => setFillRef(null))}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                )}

                {nodes.length === 0 ? (
                  <p className="browser-empty">
                    {attached ? t('browser.snapshotEmptyAttached') : t('browser.snapshotEmpty')}
                  </p>
                ) : (
                  <div className="browser-node-inline">
                    {filtered.map((n) => (
                      <div key={n.ref} className="browser-node-chip">
                        <span className="browser-node-role">{n.role}</span>
                        <span className="browser-node-name" title={n.name}>
                          {n.name || n.ref}
                        </span>
                        <button
                          type="button"
                          className="browser-node-act"
                          disabled={busy}
                          onClick={() => void clickNode(n.ref, n.name)}
                        >
                          {t('browser.actClick')}
                        </button>
                        {isFillable(n) && (
                          <button
                            type="button"
                            className="browser-node-act is-ghost"
                            disabled={busy}
                            onClick={() => {
                              setFillRef(n.ref)
                              setFillValue('')
                            }}
                          >
                            {t('browser.actFill')}
                          </button>
                        )}
                      </div>
                    ))}
                    {truncated && <span className="browser-empty">…</span>}
                  </div>
                )}
              </div>

              <div className="browser-shot-rail">
                <div className="browser-shot-rail-head">
                  <h2>{t('browser.shotList')}</h2>
                  {shots.length > 0 && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-xs wn-btn-ghost"
                      onClick={() => {
                        setShots([])
                        setShotFocusId(null)
                      }}
                    >
                      {t('browser.shotClear')}
                    </button>
                  )}
                </div>
                {shots.length === 0 ? (
                  <p className="browser-empty browser-shot-empty">{t('browser.shotEmpty')}</p>
                ) : (
                  <ul className="browser-shot-thumbs">
                    {shots.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={`browser-shot-thumb${shotFocusId === s.id ? ' is-on' : ''}`}
                          title={s.path}
                          onClick={() => setShotFocusId(s.id)}
                        >
                          <img src={s.dataUrl} alt="" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            </>
          ) : (
            <section className="browser-ledger">
              <header className="browser-ledger-toolbar">
                <h2>
                  {t('browser.colSteps')}
                  {activeRun
                    ? ` · ${activeRun.title || activeRun.session || activeRun.id.slice(0, 8)}`
                    : ''}
                  {activeSkillRootId ? ` · /${activeSkillRootId.split('/').pop()}` : ''}
                </h2>
                <div className="browser-review-actions">
                  {activeSkill ? (
                    <button
                      type="button"
                      className="wn-btn wn-btn-sm wn-btn-ghost"
                      disabled={busy || !connected}
                      onClick={() => void runSavedWorkflow(activeSkill.name)}
                    >
                      {t('browser.coachRun')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="wn-btn wn-btn-sm wn-btn-primary"
                    disabled={busy || !activeRunId}
                    onClick={() => void updateActiveSkill()}
                    title={t('browser.updateSkillHint')}
                  >
                    {t('browser.updateSkill')}
                  </button>
                </div>
              </header>

              <div className="browser-ledger-ide">
                <NotebookIDE
                  ref={notebookIdeRef}
                  scopeRootId={activeSkillRootId}
                  preferredNoteId={preferredLogNoteId}
                  title={activeSkill?.name || activeSkillRootId.split('/').pop()}
                  emptyHint={
                    activeRunId ? t('browser.skillPaneEmpty') : t('browser.ledgerPickRun')
                  }
                  treeWidth={220}
                />
              </div>
            </section>
          )}
        </div>
      </ProductLayout>

      {focusedShot && (
        <ModalPortal>
          <div
            className="wn-modal-backdrop wn-modal-backdrop-top browser-shot-modal-backdrop"
            {...backdropDismissProps(() => setShotFocusId(null))}
          >
            <div
              className="wn-modal wn-modal-xl browser-shot-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t('browser.shotTitle')}
            >
              <header className="wn-modal-header-bar">
                <h2 className="wn-modal-title">{t('browser.shotTitle')}</h2>
                <button
                  type="button"
                  className="wn-modal-close-btn"
                  aria-label={t('common.close')}
                  {...pressProps(() => setShotFocusId(null))}
                >
                  ×
                </button>
              </header>
              <div className="wn-modal-body browser-shot-modal-body">
                <img src={focusedShot.dataUrl} alt={t('browser.shotTitle')} />
                <span className="browser-shot-path" title={focusedShot.path}>
                  {focusedShot.path}
                </span>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}

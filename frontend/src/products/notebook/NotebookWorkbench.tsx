import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, Note, NoteLanguage, NoteRole, NoteSummary, NotebookGroup, ShellHost } from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { IconPlay } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { ProductLayout, rememberScalarSize, recallScalarSize, useResizable } from '../../components/layout'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { MarkdownPreview } from '../../features/notebook/MarkdownPreview'
import { NotebookMdViewToggle, type NotebookMdViewMode } from '../../features/notebook/NotebookMdViewToggle'
import { NotebookNoteMoreMenu } from '../../features/notebook/NotebookNoteMoreMenu'
import { NotebookNoteSettingsMenu } from '../../features/notebook/NotebookNoteSettingsMenu'
import { NotebookStatusBar } from '../../features/notebook/NotebookStatusBar'
import { breadcrumbLabels } from '../../features/notebook/notebookPath'
import {
  clampNotebookEditorFontSize,
  DEFAULT_NOTEBOOK_EDITOR_FONT,
  NOTEBOOK_EDITOR_FONT_SETTING_KEY,
  type NotebookEditorFontSize,
} from '../../features/notebook/notebookEditorFont'
import { saveAppSetting } from '../../stores/appPreferences'
import { NoteEditor, type NoteEditorHandle } from '../../features/notebook/NoteEditor'
import { fileToBase64DataURL } from '../../features/notebook/notebookAssets'
import { NotebookGroupModal } from '../../features/notebook/NotebookGroupModal'
import { NotebookNewFileModal, type NewFileDraft } from '../../features/notebook/NotebookNewFileModal'
import { NotebookSidebar } from '../../features/notebook/NotebookSidebar'
import { readLinkedSkillId, suggestSkillId } from '../../features/notebook/noteSkillLink'
import {
  NOTE_FILE_TYPE_PRESETS,
  extForLanguage,
  isMarkdownLikeLanguage,
} from '../../features/notebook/noteFileTypes'
import { applyNoteRoleFields } from '../../features/notebook/noteFrontmatter'
import {
  buildNotebookLayout,
  nextGroupSortOrder,
  nextNoteSortOrder,
} from '../../features/notebook/notebookTree'
import { remapRel } from '../../features/notebook/notebookPathOps'
import { pressProps, useDismissOverlays } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'
import { useLoading, withLoading } from '../../stores/loadingStore'
import {
  buildConnectionTemplate,
  buildServerChecklistTemplate,
  buildShellHostTemplate,
  extractRunCommands,
  extractSqlText,
} from '../../features/notebook/noteTemplates'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildNotebookSurface, briefList } from '../../stores/agentSurface'
import { openTerminal, openDatabase as openDatabaseWorkbench, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { useScrollActiveTabIntoView } from '../../hooks/useScrollActiveTabIntoView'

function toNoteDO(note: Note): model.NoteDO {
  return model.NoteDO.createFrom({
    id: note.id,
    groupId: note.groupId,
    title: note.title,
    content: note.content,
    language: note.language,
    role: note.role || 'note',
    sshHostId: note.sshHostId,
    connectionId: note.connectionId,
    sortOrder: note.sortOrder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  })
}

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    groupId: note.groupId,
    title: note.title,
    language: note.language,
    role: note.role || 'note',
    sshHostId: note.sshHostId,
    connectionId: note.connectionId,
    sortOrder: note.sortOrder,
    updatedAt: note.updatedAt,
  }
}

/** 历史 plaintext 升为 markdown（视图切换与预览依赖 MD）；补默认 role。 */
function adoptNoteLanguage(note: Note): Note {
  const role = note.role || 'note'
  if (note.language === 'plaintext') {
    return { ...note, language: 'markdown', role }
  }
  if (note.role) return note
  return { ...note, role }
}

/** NotebookWorkbench 笔记本产品线工作区。 */
export function NotebookWorkbench() {
  const { t } = useI18n()
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const setActiveProduct = useAppStore((s) => s.setActiveProduct)
  const activeProduct = useAppStore((s) => s.activeProduct)
  const notebookFocusNoteId = useAppStore((s) => s.notebookFocusNoteId)
  const setNotebookFocusNoteId = useAppStore((s) => s.setNotebookFocusNoteId)
  const setNotebookActiveNoteId = useAppStore((s) => s.setNotebookActiveNoteId)
  const notebookRoleFilter = useAppStore((s) => s.notebookRoleFilter)
  const setNotebookRoleFilter = useAppStore((s) => s.setNotebookRoleFilter)
  const setAgentSurface = useAppStore((s) => s.setAgentSurface)
  const languages: { id: NoteLanguage; label: string }[] = NOTE_FILE_TYPE_PRESETS.map((p) => ({
    id: p.id,
    label: t(`notebook.${p.labelKey}` as 'notebook.langMarkdown'),
  }))
  const [groups, setGroups] = useState<NotebookGroup[]>([])
  const [summaries, setSummaries] = useState<NoteSummary[]>([])
  const [openNotes, setOpenNotes] = useState<Record<string, Note>>({})
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [hosts, setHosts] = useState<ShellHost[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [search, setSearch] = useState('')
  const bootLoading = useLoading('notebook.boot')
  const listLoading = useLoading('notebook.list')
  const NOTEBOOK_SIDEBAR_WIDTH_KEY = 'notebook_sidebar_width'
  const NOTEBOOK_SIDEBAR_EXPANDED_KEY = 'notebook_sidebar_width__expanded'
  const NOTEBOOK_SIDEBAR_COLLAPSED_KEY = 'notebook_sidebar__collapsed'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(NOTEBOOK_SIDEBAR_COLLAPSED_KEY) === '1',
  )
  const {
    size: notebookSidebarWidth,
    setSizeAndSave: setNotebookSidebarWidth,
    onResizeStart: onNotebookSidebarResizeStart,
  } = useResizable({
    axis: 'x',
    storageKey: NOTEBOOK_SIDEBAR_WIDTH_KEY,
    defaultSize: 280,
    min: 220,
    max: 520,
  })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'note' | 'group'; id: string; title: string } | null>(null)
  const [groupModal, setGroupModal] = useState<NotebookGroup | null | undefined>(undefined)
  /** createGroupParentId 新建目录时的父目录 id（空=根）。 */
  const [createGroupParentId, setCreateGroupParentId] = useState('')
  /** selectedFolderId 侧栏当前选中目录（空=根）；工具栏新建落点。 */
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [mdViewMode, setMdViewMode] = useState<NotebookMdViewMode>('split')
  const [editorFontSize, setEditorFontSize] = useState<NotebookEditorFontSize>(DEFAULT_NOTEBOOK_EDITOR_FONT)
  const [saveByNote, setSaveByNote] = useState<Record<string, 'saved' | 'dirty' | 'saving'>>({})
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  useDismissOverlays(() => setTabCtxMenu(null))
  const editorRef = useRef<NoteEditorHandle>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const noteSnapshots = useRef<Record<string, string>>({})
  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const booted = useRef(false)
  /** boot 完成前不消费 notebookFocusNoteId，避免被持久化草稿覆盖。 */
  const [bootReady, setBootReady] = useState(false)
  const openNotesRef = useRef(openNotes)
  openNotesRef.current = openNotes
  const saveByNoteRef = useRef(saveByNote)
  saveByNoteRef.current = saveByNote

  const activeNote = activeTabId ? openNotes[activeTabId] ?? null : null
  const noteMdLike = Boolean(activeNote && isMarkdownLikeLanguage(activeNote.language))
  const showNoteEditor = Boolean(activeNote) && (!noteMdLike || mdViewMode !== 'preview')
  const showNotePreview = Boolean(activeNote) && noteMdLike && mdViewMode !== 'source'
  const noteEditorSplitClass =
    showNoteEditor && showNotePreview ? ' with-preview' : !showNoteEditor && showNotePreview ? ' preview-only' : ''
  const activeCrumbs = useMemo(
    () =>
      activeNote
        ? breadcrumbLabels(groups, activeNote.groupId, t('notebook.rootGroup'))
        : breadcrumbLabels(groups, selectedFolderId, t('notebook.rootGroup')),
    [activeNote, groups, selectedFolderId, t],
  )
  const activeHostName = activeNote?.sshHostId
    ? hosts.find((h) => h.id === activeNote.sshHostId)?.name
    : undefined
  const activeConnName = activeNote?.connectionId
    ? connections.find((c) => c.id === activeNote.connectionId)?.name
    : undefined
  const tabsRef = useScrollActiveTabIntoView(activeTabId)
  const [settingsOpenSignal, setSettingsOpenSignal] = useState(0)
  const [newFileGroupId, setNewFileGroupId] = useState<string | null>(null)
  /** 仅元数据进 Agent 表面；正文每次击键不刷 store，避免 Monaco 连带重渲染。 */
  const openTabsBrief = openTabIds.map((id) => openNotes[id]?.title || id).join('\0')

  useEffect(() => {
    setNotebookActiveNoteId(activeTabId)
  }, [activeTabId, setNotebookActiveNoteId])

  useEffect(() => {
    void api
      .listAppSettings()
      .then((settings) => {
        const raw = Number(settings[NOTEBOOK_EDITOR_FONT_SETTING_KEY])
        if (Number.isFinite(raw)) setEditorFontSize(clampNotebookEditorFontSize(raw))
      })
      .catch(() => {})
  }, [])

  const onEditorFontSizeChange = useCallback((size: NotebookEditorFontSize) => {
    setEditorFontSize(size)
    void saveAppSetting(NOTEBOOK_EDITOR_FONT_SETTING_KEY, String(size))
  }, [])

  useEffect(() => {
    if (activeProduct !== 'notebook') return
    const group = activeNote?.groupId ? groups.find((g) => g.id === activeNote.groupId) : undefined
    setAgentSurface(
      buildNotebookSurface({
        noteId: activeNote?.id ?? activeTabId,
        title: activeNote?.title,
        language: activeNote?.language,
        groupLabel: group?.name,
        sshHostId: activeNote?.sshHostId,
        connectionId: activeNote?.connectionId,
        openTabsBrief: briefList(
          openTabsBrief ? openTabsBrief.split('\0') : [],
          12,
        ),
      }),
    )
  }, [
    activeProduct,
    activeNote?.id,
    activeNote?.title,
    activeNote?.language,
    activeNote?.groupId,
    activeNote?.sshHostId,
    activeNote?.connectionId,
    activeTabId,
    groups,
    openTabsBrief,
    setAgentSurface,
  ])

  useEffect(() => {
    if (!tabCtxMenu) return
    const close = () => setTabCtxMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [tabCtxMenu])

  const activeSaveStatus = activeTabId ? saveByNote[activeTabId] ?? 'saved' : 'saved'

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(NOTEBOOK_SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      if (next) rememberScalarSize(NOTEBOOK_SIDEBAR_EXPANDED_KEY, notebookSidebarWidth)
      else {
        setNotebookSidebarWidth(
          recallScalarSize(NOTEBOOK_SIDEBAR_EXPANDED_KEY, notebookSidebarWidth, 220, 520),
        )
      }
      return next
    })
  }, [notebookSidebarWidth, setNotebookSidebarWidth])

  const searching = Boolean(search.trim())

  const noteSnapshot = (note: Note) =>
    JSON.stringify({
      title: note.title,
      content: note.content,
      groupId: note.groupId,
      language: note.language,
      role: note.role || 'note',
      sshHostId: note.sshHostId,
      connectionId: note.connectionId,
    })

  const markNoteSaved = useCallback((note: Note) => {
    noteSnapshots.current[note.id] = noteSnapshot(note)
    setSaveByNote((prev) => ({ ...prev, [note.id]: 'saved' }))
  }, [])

  const markNoteDirty = useCallback((id: string) => {
    setSaveByNote((prev) => (prev[id] === 'dirty' ? prev : { ...prev, [id]: 'dirty' }))
  }, [])

  const refreshSummaries = useCallback(async () => {
    const list = searching
      ? ((await api.searchNotes(search.trim())) as NoteSummary[])
      : ((await api.listNotes()) as NoteSummary[])
    setSummaries(list)
  }, [search, searching])

  const refreshAll = useCallback(async () => {
    const [groupList, noteList, hostList, connList] = await Promise.all([
      api.listNotebookGroups(),
      api.listNotes(),
      api.listShellHosts(),
      api.listConnections(),
    ])
    setGroups(groupList as NotebookGroup[])
    setSummaries(noteList as NoteSummary[])
    setHosts(hostList)
    setConnections(connList as Connection[])
    return {
      groupList: groupList as NotebookGroup[],
      noteList: noteList as NoteSummary[],
      hostList,
      connList: connList as Connection[],
    }
  }, [])

  const handleRefreshList = useCallback(async () => {
    try {
      await withLoading(
        'notebook.list',
        async () => {
          await refreshAll()
          if (searching) await refreshSummaries()
          for (const id of openTabIds) {
            const status = saveByNote[id]
            if (status === 'dirty' || status === 'saving') continue
            try {
              const note = adoptNoteLanguage((await api.getNote(id)) as Note)
              markNoteSaved(note)
              setOpenNotes((prev) => ({ ...prev, [id]: note }))
            } catch {
              /* 笔记已删除 */
            }
          }
          setStatusMessage(t('notebook.listRefreshed'))
        },
        {
          label: t('common.loading'),
          onBegin: () => setSummaries([]),
        },
      )
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }, [
    refreshAll,
    refreshSummaries,
    searching,
    openTabIds,
    saveByNote,
    markNoteSaved,
    setStatusMessage,
    t,
  ])

  const persistUI = useCallback((tabIds: string[], activeId: string | null) => {
    if (uiTimer.current) clearTimeout(uiTimer.current)
    uiTimer.current = setTimeout(() => {
      void api
        .saveNotebookUI(model.NotebookUIDO.createFrom({ openTabIds: tabIds, activeTabId: activeId ?? '' }))
        .catch(() => {})
    }, 300)
  }, [])

  const persistNote = useCallback(
    async (note: Note, opts?: { silent?: boolean }) => {
      setSaveByNote((prev) => ({ ...prev, [note.id]: 'saving' }))
      try {
        const saved = (await api.saveNote(toNoteDO(note))) as Note
        const current = openNotesRef.current[note.id]
        const diverged =
          !!current &&
          (current.content !== note.content ||
            current.title !== note.title ||
            current.groupId !== note.groupId ||
            current.language !== note.language ||
            current.sshHostId !== note.sshHostId ||
            current.connectionId !== note.connectionId)
        if (diverged && current) {
          // 保存期间用户继续输入：不回写正文，保持 dirty 并排队再存。
          setOpenNotes((prev) => ({
            ...prev,
            [note.id]: { ...current, updatedAt: saved.updatedAt },
          }))
          setSummaries((prev) => [
            toSummary({ ...saved, title: current.title, language: current.language, groupId: current.groupId }),
            ...prev.filter((s) => s.id !== saved.id),
          ])
          setSaveByNote((prev) => ({ ...prev, [note.id]: 'dirty' }))
          if (saveTimers.current[note.id]) clearTimeout(saveTimers.current[note.id])
          saveTimers.current[note.id] = setTimeout(() => {
            const again = openNotesRef.current[note.id]
            if (again) void persistNote(again, { silent: true })
          }, 400)
        } else {
          setOpenNotes((prev) => ({ ...prev, [note.id]: saved }))
          setSummaries((prev) => [toSummary(saved), ...prev.filter((s) => s.id !== saved.id)])
          markNoteSaved(saved)
          if (!opts?.silent) setStatusMessage(t('notebook.saved'))
        }
        return saved
      } catch (e) {
        setSaveByNote((prev) => ({ ...prev, [note.id]: 'dirty' }))
        setStatusMessage((e as Error).message)
        throw e
      }
    },
    [markNoteSaved, setStatusMessage, t],
  )

  const openNoteById = useCallback(
    async (id: string) => {
      const raw = (await api.getNote(id)) as Note
      const note = adoptNoteLanguage(raw)
      const promoted = note.language !== raw.language
      setOpenNotes((prev) => ({ ...prev, [id]: note }))
      setSummaries((prev) => {
        const sum = toSummary(note)
        if (prev.some((s) => s.id === id)) {
          return prev.map((s) => (s.id === id ? sum : s))
        }
        return [sum, ...prev]
      })
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setActiveTabId(id)
      if (promoted) {
        void persistNote(note, { silent: true })
      } else {
        markNoteSaved(note)
      }
    },
    [markNoteSaved, persistNote],
  )

  useEffect(() => {
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain !== 'notebook.note' && evt.domain !== 'notebook.group') return
      if (evt.domain === 'notebook.group') {
        await refreshAll()
        if (evt.label) {
          useAppStore.getState().setStatusMessage(
            evt.op === 'delete' ? `分组已删除：${evt.label}` : `分组已更新：${evt.label}`,
          )
        }
        return
      }
      await refreshSummaries()
      const noteId = evt.ids[0]
      if (evt.reveal && noteId && evt.op !== 'delete') {
        await openNoteById(noteId)
        useAppStore.getState().setStatusMessage(
          evt.label ? `已落笔记本资产：${evt.label}` : `已打开笔记 ${noteId}`,
        )
      } else if (evt.op === 'delete') {
        const deletedIds = evt.ids.filter(Boolean)
        if (deletedIds.length === 0) return
        setOpenTabIds((prev) => {
          const next = prev.filter((id) => !deletedIds.includes(id))
          setActiveTabId((cur) =>
            cur && deletedIds.includes(cur) ? next[next.length - 1] ?? null : cur,
          )
          return next
        })
        setOpenNotes((prev) => {
          const next = { ...prev }
          for (const id of deletedIds) delete next[id]
          return next
        })
        setSaveByNote((prev) => {
          const next = { ...prev }
          for (const id of deletedIds) delete next[id]
          return next
        })
      } else if (noteId && openNotesRef.current[noteId] && evt.op !== 'delete') {
        // 本机 UI 自动保存已由 persistNote 合入；回拉会盖掉正在输入的正文并造成光标偏移。
        if (evt.writeId === 'ui-notebook-save') return
        const localStatus = saveByNoteRef.current[noteId]
        if (localStatus === 'dirty' || localStatus === 'saving') return
        try {
          const note = adoptNoteLanguage((await api.getNote(noteId)) as Note)
          markNoteSaved(note)
          setOpenNotes((prev) => ({ ...prev, [noteId]: note }))
        } catch {
          /* ignore */
        }
      }
    }
    const pending = takePendingWorkbenchChanged('notebook.')
    for (const evt of pending) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [refreshSummaries, refreshAll, openNoteById, markNoteSaved])

  useEffect(() => {
    if (!bootReady || !notebookFocusNoteId || bootLoading.active) return
    const id = notebookFocusNoteId
    void openNoteById(id)
      .then(() => refreshSummaries())
      .finally(() => {
        if (useAppStore.getState().notebookFocusNoteId === id) {
          setNotebookFocusNoteId(null)
        }
      })
  }, [bootReady, notebookFocusNoteId, bootLoading.active, openNoteById, setNotebookFocusNoteId, refreshSummaries])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void withLoading(
      'notebook.boot',
      async () => {
        await refreshAll()
        const ui = await api.getNotebookUI()
        const tabIds = ui.openTabIds ?? []
        const loaded: Record<string, Note> = {}
        const promoted: Note[] = []
        for (const id of tabIds) {
          try {
            const raw = (await api.getNote(id)) as Note
            const note = adoptNoteLanguage(raw)
            loaded[id] = note
            if (note.language !== raw.language) promoted.push(note)
          } catch {
            /* 跳过已删除笔记 */
          }
        }
        let validIds = tabIds.filter((id) => loaded[id])
        // 写入笔记本后的 focus 优先于持久化草稿，避免 boot 盖掉刚保存的笔记。
        const focusId = useAppStore.getState().notebookFocusNoteId?.trim() || ''
        if (focusId && !loaded[focusId]) {
          try {
            const raw = (await api.getNote(focusId)) as Note
            const note = adoptNoteLanguage(raw)
            loaded[focusId] = note
            if (note.language !== raw.language) promoted.push(note)
            validIds = [...validIds.filter((id) => id !== focusId), focusId]
          } catch {
            /* focus 笔记已删则回退持久化 UI */
          }
        }
        setOpenNotes(loaded)
        for (const n of Object.values(loaded)) markNoteSaved(n)
        setOpenTabIds(validIds)
        const activeFromFocus = focusId && loaded[focusId] ? focusId : ''
        setActiveTabId(
          activeFromFocus ||
            (ui.activeTabId && loaded[ui.activeTabId] ? ui.activeTabId : validIds[0] ?? null),
        )
        if (activeFromFocus) {
          setNotebookFocusNoteId(null)
        }
        await Promise.all(
          promoted.map((n) =>
            api.saveNote(toNoteDO(n)).catch(() => {
              /* 启动升级失败不挡 UI */
            }),
          ),
        )
      },
      {
        label: t('notebook.loading'),
        onBegin: () => {
          setSummaries([])
          setGroups([])
        },
      },
    )
      .catch((e) => setStatusMessage((e as Error).message))
      .finally(() => setBootReady(true))
  }, [refreshAll, setStatusMessage, markNoteSaved, setNotebookFocusNoteId, t])

  useEffect(() => {
    if (bootLoading.active) return
    const t = setTimeout(() => {
      void refreshSummaries().catch((e) => setStatusMessage((e as Error).message))
    }, 300)
    return () => clearTimeout(t)
  }, [search, bootLoading.active, refreshSummaries, setStatusMessage])

  useEffect(() => {
    if (bootLoading.active) return
    persistUI(openTabIds, activeTabId)
  }, [openTabIds, activeTabId, bootLoading.active, persistUI])

  useWorkbenchCommand(Capability.NotebookOpen, (cmd) => {
    const existingId = payloadStr(cmd.payload, 'noteId')
    if (existingId) {
      useAppStore.getState().setNotebookFocusNoteId(existingId)
      // boot 未完成时只记 focus，避免 open 后被持久化草稿覆盖。
      if (!bootReady || bootLoading.active) return
      void openNoteById(existingId)
        .then(() => {
          if (useAppStore.getState().notebookFocusNoteId === existingId) {
            setNotebookFocusNoteId(null)
          }
        })
        .catch((e) => setStatusMessage((e as Error).message))
      return
    }
    const hostId = payloadStr(cmd.payload, 'hostId')
    const connectionId = payloadStr(cmd.payload, 'connectionId')
    const initialCommand = payloadStr(cmd.payload, 'initialCommand')
    void (async () => {
      try {
        const { hostList, connList } = await refreshAll()
        const host = hostId ? hostList.find((h) => h.id === hostId) : undefined
        const conn = connectionId ? connList.find((c) => c.id === connectionId) : undefined
        let title = t('notebook.newNoteTitle')
        let content = initialCommand ?? ''
        let language: NoteLanguage = 'markdown'
        let sshHostId = hostId ?? ''
        let noteConnectionId = connectionId ?? ''

        if (conn) {
          title = t('notebook.noteFromConn', { name: conn.name })
          content = content || buildConnectionTemplate(conn)
          sshHostId = conn.sshHostId || sshHostId
          noteConnectionId = conn.id
        } else if (host) {
          title = t('notebook.noteFromHost', { name: host.name })
          content = content || buildShellHostTemplate(host)
        }

        // groupId 可空：后端 SaveNote 会挂到默认分组
        const saved = (await api.saveNote(
          model.NoteDO.createFrom({
            id: '',
            groupId: '',
            title,
            content,
            language,
            role: 'note',
            sshHostId,
            connectionId: noteConnectionId,
            sortOrder: 0,
            createdAt: 0,
            updatedAt: 0,
          })
        )) as Note
        await refreshAll()
        await openNoteById(saved.id)
        setStatusMessage(t('notebook.createdNote', { title: saved.title }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  })

  const scheduleSave = useCallback(
    (note: Note) => {
      if (saveTimers.current[note.id]) clearTimeout(saveTimers.current[note.id])
      saveTimers.current[note.id] = setTimeout(() => {
        // 定时器触发时取最新正文，避免用过期快照覆盖后续输入。
        const latest = openNotesRef.current[note.id] ?? note
        void persistNote(latest, { silent: true })
      }, 400)
    },
    [persistNote],
  )

  const flushSaveActive = useCallback(async () => {
    if (!activeNote) return
    if (saveTimers.current[activeNote.id]) {
      clearTimeout(saveTimers.current[activeNote.id])
      delete saveTimers.current[activeNote.id]
    }
    const snap = noteSnapshots.current[activeNote.id]
    if (snap === noteSnapshot(activeNote) && activeSaveStatus !== 'dirty') {
      setStatusMessage(t('notebook.saved'))
      return
    }
    await persistNote(activeNote)
  }, [activeNote, activeSaveStatus, persistNote, setStatusMessage, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
      if (!activeNote) return
      e.preventDefault()
      void flushSaveActive()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeNote, flushSaveActive])

  /** updateActiveNote 合并当前笔记字段；无实际变化则不 setState，避免 Monaco 回推造成更新环。 */
  const updateActiveNote = (patch: Partial<Note>) => {
    if (!activeTabId || !activeNote) return
    const nextPatch = { ...patch }
    if (nextPatch.groupId !== undefined && nextPatch.groupId !== activeNote.groupId) {
      nextPatch.sortOrder = nextNoteSortOrder(
        summaries.filter((s) => s.id !== activeTabId),
        nextPatch.groupId,
      )
    }
    const changed = (Object.keys(nextPatch) as (keyof Note)[]).some(
      (k) => nextPatch[k] !== activeNote[k],
    )
    if (!changed) return
    const next = { ...activeNote, ...nextPatch }
    setOpenNotes((prev) => ({ ...prev, [activeTabId]: next }))
    markNoteDirty(activeTabId)
    scheduleSave(next)
  }

  /** openCreateFile IDE 新建文件对话框。 */
  const openCreateFile = (groupId = '') => {
    setNewFileGroupId(groupId)
  }

  /** createFile 按类型新建运维文件并打开（可绑 SSH）。 */
  const createFile = async (draft: NewFileDraft) => {
    const groupId = draft.groupId || ''
    const saved = (await api.saveNote(
      model.NoteDO.createFrom({
        id: '',
        groupId,
        title: draft.title.trim() || t('common.unnamed'),
        content: '',
        language: draft.language || 'shell',
        role: 'note',
        sshHostId: draft.sshHostId || '',
        connectionId: '',
        sortOrder: nextNoteSortOrder(summaries, groupId),
        createdAt: 0,
        updatedAt: 0,
      }),
    )) as Note
    setSummaries((prev) => [...prev, toSummary(saved)])
    markNoteSaved(saved)
    await openNoteById(saved.id)
    setStatusMessage(t('notebook.created'))
  }

  const openCreateFolder = (parentId = '') => {
    setCreateGroupParentId(parentId)
    setGroupModal(null)
  }

  const saveGroup = async (name: string) => {
    if (groupModal) {
      const saved = (await api.saveNotebookGroup(
        model.NotebookGroupDO.createFrom({ ...groupModal, name })
      )) as NotebookGroup
      setGroups((prev) => prev.map((g) => (g.id === saved.id ? saved : g)))
      setStatusMessage(t('notebook.renamedGroup', { name: saved.name }))
      return
    }
    const parentId = createGroupParentId || ''
    const saved = (await api.saveNotebookGroup(
      model.NotebookGroupDO.createFrom({
        id: '',
        name,
        parentId,
        sortOrder: nextGroupSortOrder(groups, parentId),
        createdAt: 0,
        updatedAt: 0,
      })
    )) as NotebookGroup
    setGroups((prev) => [...prev, saved])
    setStatusMessage(t('notebook.createdGroup', { name: saved.name }))
  }

  const duplicateNote = async () => {
    if (!activeNote) return
    try {
      const saved = (await api.duplicateNote(activeNote.id)) as Note
      setSummaries((prev) => [toSummary(saved), ...prev])
      await openNoteById(saved.id)
      setStatusMessage(t('notebook.duplicated'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const exportNote = async () => {
    if (!activeNote) return
    try {
      const path = await api.exportNote(activeNote.id)
      if (path) setStatusMessage(t('notebook.exported', { path }))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const revealNoteInFinder = async (noteId?: string) => {
    try {
      await api.revealNotebookNote(noteId || '')
      setStatusMessage(t('notebook.revealedInFinder'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const publishSkill = async (noteOverride?: Note) => {
    const target = noteOverride || activeNote
    if (!target) return
    const linked = readLinkedSkillId(target.content)
    const id = linked || suggestSkillId(target.title, target.id)
    try {
      const sk = await api.publishNoteAsSkill(
        model.AgentSkillPublishDO.createFrom({
          id,
          name: target.title || id,
          description: '',
          content: '',
          noteId: target.id,
        }),
      )
      setStatusMessage(t('notebook.publishSkillOk', { id: sk.id }))
      await refreshAll()
      const refreshed = await api.getNote(target.id)
      if (refreshed) {
        setOpenNotes((prev) => ({
          ...prev,
          [target.id]: adoptNoteLanguage(refreshed as Note),
        }))
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** makeNoteRole 侧栏右键：笔记做成记忆 / 工作流 / 普通。 */
  const makeNoteRole = async (noteId: string, role: NoteRole) => {
    try {
      let note = openNotes[noteId]
      if (!note) {
        const raw = await api.getNote(noteId)
        if (!raw) throw new Error('note not found')
        note = adoptNoteLanguage(raw as Note)
      }
      const fields = applyNoteRoleFields(note, role)
      const next: Note = { ...note, ...fields }
      if (role === 'skill') {
        const saved = (await api.saveNote(toNoteDO(next))) as Note
        setOpenNotes((prev) => (prev[noteId] ? { ...prev, [noteId]: adoptNoteLanguage(saved) } : prev))
        setSummaries((prev) => prev.map((s) => (s.id === noteId ? toSummary(saved) : s)))
        await publishSkill(adoptNoteLanguage(saved))
        return
      }
      const saved = (await api.saveNote(toNoteDO(next))) as Note
      const adopted = adoptNoteLanguage(saved)
      setOpenNotes((prev) => (prev[noteId] ? { ...prev, [noteId]: adopted } : prev))
      setSummaries((prev) => prev.map((s) => (s.id === noteId ? toSummary(adopted) : s)))
      setSaveByNote((prev) => ({ ...prev, [noteId]: 'saved' }))
      setStatusMessage(role === 'memory' ? t('notebook.madeMemory') : t('notebook.madeNote'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  /** patchActiveNoteSettings 设置菜单改字段；改角色时走 applyNoteRoleFields。 */
  const patchActiveNoteSettings = (patch: Partial<Note>) => {
    if (!activeNote) return
    if (patch.role && patch.role !== (activeNote.role || 'note')) {
      const fields = applyNoteRoleFields(
        {
          content: patch.content ?? activeNote.content,
          language: patch.language ?? activeNote.language,
        },
        patch.role as NoteRole,
      )
      updateActiveNote({ ...patch, ...fields })
      return
    }
    updateActiveNote(patch)
  }

  const insertTemplate = () => {
    if (!activeNote) return
    const host = activeNote.sshHostId ? hosts.find((h) => h.id === activeNote.sshHostId) : undefined
    const conn = activeNote.connectionId ? connections.find((c) => c.id === activeNote.connectionId) : undefined
    let block = ''
    if (conn) block = buildConnectionTemplate(conn)
    else if (host) block = buildShellHostTemplate(host)
    else block = buildServerChecklistTemplate(activeNote.title)
    const content = activeNote.content.trim() ? `${activeNote.content}\n\n${block}` : block
    updateActiveNote({ content, language: 'markdown' })
    setStatusMessage(t('notebook.templateInserted'))
  }

  /** appendAssetMarkdown 在光标插入附件 Markdown；非 markdown 笔记自动升为 markdown。 */
  const appendAssetMarkdown = useCallback(
    (snippets: string[]) => {
      if (!activeNote || snippets.length === 0) return
      const block = snippets.join('\n\n') + '\n'
      if (editorRef.current) {
        editorRef.current.insertText(block)
        if (!isMarkdownLikeLanguage(activeNote.language)) {
          setOpenNotes((prev) => {
            const cur = prev[activeNote.id]
            if (!cur || isMarkdownLikeLanguage(cur.language)) return prev
            return { ...prev, [activeNote.id]: { ...cur, language: 'markdown' } }
          })
          markNoteDirty(activeNote.id)
        }
        return
      }
      const content = activeNote.content.trim()
        ? `${activeNote.content}\n\n${block}`
        : block
      updateActiveNote({ content, language: 'markdown' })
    },
    // updateActiveNote / markNoteDirty 随 activeNote 闭包；与工作台其它写入口一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeNote],
  )

  const insertFilesAsAssets = useCallback(
    async (files: File[]) => {
      if (!activeNote || files.length === 0) return
      try {
        const snippets: string[] = []
        for (const file of files) {
          const data = await fileToBase64DataURL(file)
          const asset = await api.saveNotebookAsset(
            model.NotebookAssetUploadDO.createFrom({
              noteId: activeNote.id,
              name: file.name || (file.type.startsWith('image/') ? 'image.png' : 'file'),
              mime: file.type || '',
              data,
            }),
          )
          snippets.push(asset.markdown)
        }
        appendAssetMarkdown(snippets)
        setStatusMessage(
          snippets.length === 1
            ? t('notebook.assetInserted')
            : t('notebook.assetsInserted', { count: snippets.length }),
        )
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    },
    [activeNote, appendAssetMarkdown, setStatusMessage, t],
  )

  const pickAssets = useCallback(
    async (imagesOnly: boolean) => {
      if (!activeNote) return
      try {
        const assets = await api.pickNotebookAssets(activeNote.id, imagesOnly)
        if (!assets.length) return
        appendAssetMarkdown(assets.map((a) => a.markdown))
        setStatusMessage(
          assets.length === 1
            ? t('notebook.assetInserted')
            : t('notebook.assetsInserted', { count: assets.length }),
        )
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    },
    [activeNote, appendAssetMarkdown, setStatusMessage, t],
  )

  const closeTab = (id: string) => {
    setOpenTabIds((prev) => {
      const next = prev.filter((t) => t !== id)
      if (activeTabId === id) setActiveTabId(next[next.length - 1] ?? null)
      return next
    })
  }

  /** closeOtherTabs 关闭除当前外的笔记标签。 */
  const closeOtherTabs = (keepId: string) => {
    setOpenTabIds([keepId])
    setActiveTabId(keepId)
  }

  /** closeAllTabs 关闭全部笔记标签。 */
  const closeAllTabs = () => {
    setOpenTabIds([])
    setActiveTabId(null)
  }

  const runInTerminal = () => {
    if (!activeNote) return
    const text = editorRef.current?.getSelectedText() ?? activeNote.content
    const command = extractRunCommands(text)
    if (!command) {
      setStatusMessage(t('notebook.noCommands'))
      return
    }
    if (activeNote.sshHostId) {
      openTerminal({ hostId: activeNote.sshHostId, initialCommand: command }, 'notebook')
    } else {
      openTerminal({ localShell: true, initialCommand: command }, 'notebook')
    }
    setStatusMessage(t('notebook.runningCmd'))
  }

  /** openDatabase 跳转到数据库并带入 SQL、可选执行。 */
  const openDatabase = (runSql = true) => {
    if (!activeNote?.connectionId) return
    const conn = connections.find((c) => c.id === activeNote.connectionId)
    const text = editorRef.current?.getSelectedText() ?? activeNote.content
    const sql = extractSqlText(text)
    if (!sql) {
      setStatusMessage(conn ? t('notebook.openingConn', { name: conn.name }) : t('notebook.openingDb'))
    } else if (runSql) {
      setStatusMessage(conn ? t('notebook.openingConnSql', { name: conn.name }) : t('notebook.openingDbSql'))
    } else {
      setStatusMessage(conn ? t('notebook.openingConnFill', { name: conn.name }) : t('notebook.openingDbFill'))
    }
    openDatabaseWorkbench(
      {
        connectionId: activeNote.connectionId,
        initialSql: sql || undefined,
        runSql: runSql && Boolean(sql),
      },
      'notebook',
    )
  }

  /** onConnectionLinkChange 关联数据库连接，并同步 SSH 跳板主机。 */
  const onConnectionLinkChange = (connectionId: string) => {
    const conn = connectionId ? connections.find((c) => c.id === connectionId) : undefined
    const patch: Partial<Note> = { connectionId }
    if (conn?.sshHostId) patch.sshHostId = conn.sshHostId
    updateActiveNote(patch)
  }

  const applyPathMutation = useCallback(
    async (from: string, to: string) => {
      const mapId = (id: string) => remapRel(id, from, to)
      setOpenTabIds((prev) => prev.map(mapId))
      setActiveTabId((cur) => (cur ? mapId(cur) : cur))
      setSelectedFolderId((cur) => (cur ? mapId(cur) : cur))
      setOpenNotes((prev) => {
        const next: Record<string, Note> = {}
        for (const [id, note] of Object.entries(prev)) {
          const nid = mapId(id)
          const base = nid.split('/').pop() || note.title
          const title = nid.endsWith('/SKILL.md')
            ? nid.split('/').slice(-2, -1)[0] || note.title
            : base.replace(/\.[^.]+$/, '') || note.title
          next[nid] = {
            ...note,
            id: nid,
            groupId: mapId(note.groupId || ''),
            title,
          }
        }
        return next
      })
      setSaveByNote((prev) => {
        const next: Record<string, (typeof prev)[string]> = {}
        for (const [id, st] of Object.entries(prev)) next[mapId(id)] = st
        return next
      })
      await refreshAll()
    },
    [refreshAll],
  )

  const renameNotebookPath = useCallback(
    async (rel: string, newName: string) => {
      const m = await api.renameNotebookPath(rel, newName)
      await applyPathMutation(m.from, m.to)
    },
    [applyPathMutation],
  )

  const moveNotebookPath = useCallback(
    async (fromRel: string, destDirRel: string) => {
      const m = await api.moveNotebookPath(fromRel, destDirRel)
      await applyPathMutation(m.from, m.to)
    },
    [applyPathMutation],
  )

  const copyNotebookPath = useCallback(
    async (fromRel: string, destDirRel: string) => {
      await api.copyNotebookPath(fromRel, destDirRel)
      await refreshAll()
    },
    [refreshAll],
  )

  const createDirInline = useCallback(
    async (parentRel: string, name: string) => {
      const id = await api.createNotebookDir(parentRel, name)
      await refreshAll()
      setSelectedFolderId(id)
    },
    [refreshAll],
  )

  const createFileInline = useCallback(
    async (parentRel: string, name: string) => {
      const saved = (await api.createNotebookFile(parentRel, name)) as Note
      await refreshAll()
      await openNoteById(saved.id)
    },
    [refreshAll, openNoteById],
  )

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteNotebookPath(deleteTarget.id)
      if (deleteTarget.kind === 'note') {
        setSummaries((prev) => prev.filter((s) => s.id !== deleteTarget.id))
        setOpenTabIds((prev) => prev.filter((id) => id !== deleteTarget.id))
        setOpenNotes((prev) => {
          const next = { ...prev }
          delete next[deleteTarget.id]
          return next
        })
        setSaveByNote((prev) => {
          const next = { ...prev }
          delete next[deleteTarget.id]
          return next
        })
        if (activeTabId === deleteTarget.id) setActiveTabId(null)
      } else {
        // 删目录：关掉其下打开的标签
        const prefix = deleteTarget.id + '/'
        setOpenTabIds((prev) => prev.filter((id) => id !== deleteTarget.id && !id.startsWith(prefix)))
        setOpenNotes((prev) => {
          const next = { ...prev }
          for (const id of Object.keys(next)) {
            if (id === deleteTarget.id || id.startsWith(prefix)) delete next[id]
          }
          return next
        })
        if (selectedFolderId === deleteTarget.id || selectedFolderId.startsWith(prefix)) {
          setSelectedFolderId('')
        }
        await refreshAll()
      }
      setStatusMessage(t('notebook.deleted'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setDeleteTarget(null)
    }
  }

  const persistNotebookLayout = useCallback(
    async (layout: { groupOrder: string[]; notesByGroup: Record<string, string[]> }) => {
      try {
        await api.applyNotebookLayout(
          model.NotebookLayoutDO.createFrom({
            groupOrder: layout.groupOrder,
            notesByGroup: layout.notesByGroup,
          }),
        )
        setGroups((prev) =>
          layout.groupOrder.map((id, i) => {
            const g = prev.find((x) => x.id === id)
            return g ? { ...g, sortOrder: i } : null
          }).filter((g): g is NotebookGroup => Boolean(g)),
        )
        setSummaries((prev) => {
          const byId = new Map(prev.map((n) => [n.id, n]))
          const next: NoteSummary[] = []
          const gids = ['', ...layout.groupOrder]
          for (const gid of gids) {
            const ids = layout.notesByGroup[gid] ?? []
            ids.forEach((nid, i) => {
              const n = byId.get(nid)
              if (n) next.push({ ...n, groupId: gid, sortOrder: i })
            })
          }
          return next
        })
        setOpenNotes((prev) => {
          const out = { ...prev }
          const gids = ['', ...layout.groupOrder]
          for (const id of Object.keys(out)) {
            for (const gid of gids) {
              if ((layout.notesByGroup[gid] ?? []).includes(id)) {
                out[id] = { ...out[id], groupId: gid }
                break
              }
            }
          }
          return out
        })
        setStatusMessage(t('notebook.layoutSaved'))
      } catch (e) {
        await refreshAll()
        setStatusMessage((e as Error).message)
        throw e
      }
    },
    [refreshAll, setStatusMessage, t],
  )

  const handleBatchDeleteNotes = async (ids: string[]) => {
    const known = new Set(summaries.map((s) => s.id))
    const toDelete = [...new Set(ids.filter((id) => known.has(id)))]
    if (toDelete.length === 0) {
      throw new Error(t('notebook.batchNone'))
    }
    const idSet = new Set(toDelete)

    for (const id of toDelete) {
      if (saveTimers.current[id]) {
        clearTimeout(saveTimers.current[id])
        delete saveTimers.current[id]
      }
      delete noteSnapshots.current[id]
    }

    const nextSummaries = summaries.filter((s) => !idSet.has(s.id))
    await api.deleteNotes(toDelete)
    try {
      await persistNotebookLayout(buildNotebookLayout(groups, nextSummaries))
    } catch {
      setSummaries(nextSummaries)
    }

    setOpenTabIds((prev) => {
      const next = prev.filter((id) => !idSet.has(id))
      setActiveTabId((current) => (current && idSet.has(current) ? next[next.length - 1] ?? null : current))
      return next
    })
    setOpenNotes((prev) => {
      const next = { ...prev }
      for (const id of toDelete) delete next[id]
      return next
    })
    setSaveByNote((prev) => {
      const next = { ...prev }
      for (const id of toDelete) delete next[id]
      return next
    })
  }

  return (
    <div className="product-workbench notebook-workbench is-ide">
      <LoadingPane loadingKey="notebook.boot" label={t('notebook.loading')} minHeight={480}>
      <ProductLayout
        storageKey={NOTEBOOK_SIDEBAR_WIDTH_KEY}
        resizeTitle={t('common.resizeWidth')}
        defaultWidth={280}
        minWidth={220}
        maxWidth={520}
        width={notebookSidebarWidth}
        onResizeStart={onNotebookSidebarResizeStart}
        sidebarClassName="notebook-sidebar"
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebarCollapse={toggleSidebarCollapse}
        sidebarRailLabel={t('notebook.sidebarRail')}
        sidebarExpandTitle={t('notebook.expandSidebar')}
        sidebar={
          <NotebookSidebar
            groups={groups}
            summaries={summaries}
            search={search}
            activeTabId={activeTabId}
            selectedFolderId={selectedFolderId}
            roleFilter={notebookRoleFilter}
            onRoleFilterChange={(role) => setNotebookRoleFilter(role as '' | 'memory' | 'skill')}
            onSelectFolder={setSelectedFolderId}
            onSearchChange={setSearch}
            onOpenNote={(id) => {
              const note = summaries.find((n) => n.id === id)
              if (note) setSelectedFolderId(note.groupId || '')
              void openNoteById(id)
            }}
            onDeleteGroup={(id, title) => setDeleteTarget({ kind: 'group', id, title })}
            onDeleteNote={(id, title) => setDeleteTarget({ kind: 'note', id, title })}
            onMakeNoteRole={(noteId, role) => void makeNoteRole(noteId, role)}
            onBatchDelete={handleBatchDeleteNotes}
            onRefresh={handleRefreshList}
            onRevealWorkspace={() => void revealNoteInFinder('')}
            onRevealPath={(rel) => void api.revealNotebookPath(rel).then(() => setStatusMessage(t('notebook.revealedInFinder')))}
            onRenamePath={renameNotebookPath}
            onMovePath={moveNotebookPath}
            onCopyPath={copyNotebookPath}
            onCreateDirInline={createDirInline}
            onCreateFileInline={createFileInline}
            refreshing={listLoading.active}
          />
        }
      >
        <main className="app-main notebook-main">
          <div className="editor-chrome notebook-editor-chrome">
            <div className="wn-tabs" ref={tabsRef}>
              {openTabIds.map((id) => {
                const note = openNotes[id]
                if (!note) return null
                const dirty = saveByNote[id] === 'dirty' || saveByNote[id] === 'saving'
                return (
                  <button
                    key={id}
                    type="button"
                    data-tab-id={id}
                    className={`wn-tab ${id === activeTabId ? 'active' : ''}${dirty ? ' is-dirty' : ''}`}
                    {...pressProps(() => setActiveTabId(id))}
                    onContextMenu={(e) => openTabContextMenu(e, id, setTabCtxMenu, setActiveTabId)}
                  >
                    {dirty && <span className="notebook-tab-dirty" aria-hidden />}
                    <span className="tab-title">
                      {note.title || t('common.unnamed')}
                      <span className="notebook-tab-ext">{extForLanguage(note.language)}</span>
                    </span>
                    <span
                      className="wn-tab-close"
                      {...pressProps(() => closeTab(id), { stop: true })}
                    >
                      ×
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {activeNote ? (
            <div className="notebook-editor-area">
              <div className="notebook-meta-bar notebook-ide-bar">
                <nav className="notebook-breadcrumb" aria-label={t('notebook.breadcrumbAria')}>
                  {activeCrumbs.map((part, i) => (
                    <span key={`${part}-${i}`} className="notebook-breadcrumb-part">
                      {i > 0 && <span className="notebook-breadcrumb-sep">/</span>}
                      <span>{part}</span>
                    </span>
                  ))}
                  <span className="notebook-breadcrumb-sep">/</span>
                  <input
                    className="notebook-title-input notebook-breadcrumb-title"
                    value={activeNote.title}
                    onChange={(e) => updateActiveNote({ title: e.target.value })}
                    placeholder={t('notebook.titlePlaceholder')}
                  />
                  <span className="notebook-breadcrumb-ext">{extForLanguage(activeNote.language)}</span>
                </nav>
                <div className="notebook-meta-bar-right">
                  {noteMdLike && (
                    <>
                      <NotebookMdViewToggle mode={mdViewMode} onChange={setMdViewMode} />
                      <div className="notebook-meta-divider" aria-hidden />
                    </>
                  )}
                  <button
                    type="button"
                    className="notebook-meta-icon-btn"
                    title={t('notebook.runTerminal')}
                    {...pressProps(runInTerminal)}
                  >
                    <IconPlay size={14} />
                  </button>
                  <NotebookNoteMoreMenu
                    hasConnection={Boolean(activeNote.connectionId)}
                    onInsertImage={() => void pickAssets(true)}
                    onInsertAttachment={() => void pickAssets(false)}
                    onInsertTemplate={insertTemplate}
                    onDuplicate={() => void duplicateNote()}
                    onExport={() => void exportNote()}
                    onRevealInFinder={() => void revealNoteInFinder(activeNote.id)}
                    onOpenDatabase={() => openDatabase(true)}
                    onDelete={() =>
                      setDeleteTarget({ kind: 'note', id: activeNote.id, title: activeNote.title })
                    }
                  />
                  <NotebookNoteSettingsMenu
                    note={activeNote}
                    groups={groups}
                    hosts={hosts}
                    connections={connections}
                    languages={languages}
                    editorFontSize={editorFontSize}
                    onEditorFontSizeChange={onEditorFontSizeChange}
                    onPatch={patchActiveNoteSettings}
                    onConnectionLink={onConnectionLinkChange}
                    openSignal={settingsOpenSignal}
                  />
                  {(activeSaveStatus === 'dirty' || activeSaveStatus === 'saving') && (
                    <button
                      type="button"
                      className={`wn-btn wn-btn-sm ${activeSaveStatus === 'dirty' ? 'wn-btn-primary' : 'wn-btn-ghost'}`}
                      disabled={activeSaveStatus === 'saving'}
                      title={t('notebook.saveShortcut')}
                      {...pressProps(() => void flushSaveActive(), { disabled: activeSaveStatus === 'saving' })}
                    >
                      {activeSaveStatus === 'saving' ? t('notebook.saving') : t('notebook.save')}
                    </button>
                  )}
                </div>
              </div>
              <div
                className={`notebook-editor-split${noteEditorSplitClass}`}
                style={{ ['--notebook-editor-font-size' as string]: `${editorFontSize}px` }}
              >
                {showNoteEditor && (
                  <NoteEditor
                    ref={editorRef}
                    noteId={activeNote.id}
                    language={activeNote.language}
                    content={activeNote.content}
                    editorFontSize={editorFontSize}
                    onChange={(content) => updateActiveNote({ content })}
                    onRunSelection={runInTerminal}
                    onInsertFiles={insertFilesAsAssets}
                  />
                )}
                {showNotePreview && (
                  <div
                    className="notebook-preview-pane"
                    title={mdViewMode === 'preview' ? t('notebook.previewEditHint') : undefined}
                    onDoubleClick={mdViewMode === 'preview' ? () => setMdViewMode('split') : undefined}
                  >
                    {mdViewMode === 'preview' && (
                      <div className="notebook-preview-edit-bar">
                        <span>{t('notebook.previewOnlyHint')}</span>
                        <button
                          type="button"
                          className="wn-btn wn-btn-sm wn-btn-primary"
                          {...pressProps(() => setMdViewMode('split'))}
                        >
                          {t('notebook.enterEdit')}
                        </button>
                      </div>
                    )}
                    <MarkdownPreview content={activeNote.content} noteId={activeNote.id} />
                  </div>
                )}
              </div>
              <NotebookStatusBar
                note={activeNote}
                saveStatus={activeSaveStatus}
                hostName={activeHostName}
                connectionName={activeConnName}
                onPickLanguage={() => setSettingsOpenSignal((n) => n + 1)}
                onRevealInFinder={() => void revealNoteInFinder(activeNote.id)}
              />
            </div>
          ) : (
            <EmptyState
              title={t('notebook.emptyWorkspace')}
              hint={t('notebook.emptyWorkspaceHint')}
              actions={[
                {
                  label: t('notebook.newFile'),
                  onPress: () => openCreateFile(selectedFolderId),
                  primary: true,
                },
              ]}
            />
          )}
        </main>
      </ProductLayout>
      </LoadingPane>

      <NotebookNewFileModal
        open={newFileGroupId !== null}
        groupId={newFileGroupId ?? ''}
        hosts={hosts}
        defaultHostId={activeNote?.sshHostId || ''}
        onClose={() => setNewFileGroupId(null)}
        onSubmit={createFile}
      />

      {tabCtxMenu && (
        <TabContextMenu
          menu={tabCtxMenu}
          disableCloseOthers={openTabIds.length <= 1}
          onDismiss={() => setTabCtxMenu(null)}
          onClose={() => closeTab(tabCtxMenu.tabId)}
          onCloseOthers={() => closeOtherTabs(tabCtxMenu.tabId)}
          onCloseAll={closeAllTabs}
        />
      )}

      <NotebookGroupModal
        open={groupModal !== undefined}
        initial={groupModal ?? null}
        onClose={() => setGroupModal(undefined)}
        onSubmit={saveGroup}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.kind === 'group' ? t('notebook.deleteGroupTitle') : t('notebook.deleteNoteTitle')}
        message={
          deleteTarget?.kind === 'group'
            ? t('notebook.deleteGroupMsg', { title: deleteTarget.title })
            : t('notebook.deleteNoteMsg', { title: deleteTarget?.title ?? '' })
        }
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  )
}

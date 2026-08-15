import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, Note, NoteLanguage, NoteSummary, NotebookGroup, ShellHost } from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { IconDatabase, IconDocker, IconNotebook, IconPlay, IconPlus, IconServer } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TabContextMenu, openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { MarkdownPreview } from '../../features/notebook/MarkdownPreview'
import { NoteEditor, type NoteEditorHandle } from '../../features/notebook/NoteEditor'
import { NotebookGroupModal } from '../../features/notebook/NotebookGroupModal'
import { NotebookSidebar } from '../../features/notebook/NotebookSidebar'
import { buildNotebookLayout, moveNoteInTree, nextNoteSortOrder } from '../../features/notebook/notebookTree'
import { Select, pressProps, useDismissOverlays } from '../../components/compat'
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
import { openProductLink, useWorkbenchCommand } from '../../stores/productLink'
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
    sshHostId: note.sshHostId,
    connectionId: note.connectionId,
    sortOrder: note.sortOrder,
    updatedAt: note.updatedAt,
  }
}

/** NotebookWorkbench 笔记本产品线工作区。 */
export function NotebookWorkbench() {
  const { t } = useI18n()
  const {
    setStatusMessage,
    setActiveProduct,
    activeProduct,
    notebookFocusNoteId,
    setNotebookFocusNoteId,
    setNotebookActiveNoteId,
    setAgentSurface,
  } = useAppStore()
  const languages: { id: NoteLanguage; label: string }[] = [
    { id: 'plaintext', label: t('notebook.langPlain') },
    { id: 'shell', label: t('notebook.langShell') },
    { id: 'markdown', label: t('notebook.langMarkdown') },
  ]
  const [groups, setGroups] = useState<NotebookGroup[]>([])
  const [summaries, setSummaries] = useState<NoteSummary[]>([])
  const [openNotes, setOpenNotes] = useState<Record<string, Note>>({})
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [hosts, setHosts] = useState<ShellHost[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'note' | 'group'; id: string; title: string } | null>(null)
  const [groupModal, setGroupModal] = useState<NotebookGroup | null | undefined>(undefined)
  const [showPreview, setShowPreview] = useState(false)
  const [saveByNote, setSaveByNote] = useState<Record<string, 'saved' | 'dirty' | 'saving'>>({})
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  useDismissOverlays(() => setTabCtxMenu(null))
  const editorRef = useRef<NoteEditorHandle>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const noteSnapshots = useRef<Record<string, string>>({})
  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const booted = useRef(false)

  const activeNote = activeTabId ? openNotes[activeTabId] ?? null : null
  const tabsRef = useScrollActiveTabIntoView(activeTabId)

  useEffect(() => {
    setNotebookActiveNoteId(activeTabId)
  }, [activeTabId, setNotebookActiveNoteId])

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
          openTabIds.map((id) => openNotes[id]?.title || id),
          12,
        ),
      }),
    )
  }, [
    activeProduct,
    activeNote,
    activeTabId,
    groups,
    openTabIds,
    openNotes,
    setAgentSurface,
  ])

  useEffect(() => {
    if (!tabCtxMenu) return
    const close = () => setTabCtxMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [tabCtxMenu])

  const activeSaveStatus = activeTabId ? saveByNote[activeTabId] ?? 'saved' : 'saved'
  const searching = Boolean(search.trim())

  const noteSnapshot = (note: Note) =>
    JSON.stringify({
      title: note.title,
      content: note.content,
      groupId: note.groupId,
      language: note.language,
      sshHostId: note.sshHostId,
      connectionId: note.connectionId,
    })

  const markNoteSaved = useCallback((note: Note) => {
    noteSnapshots.current[note.id] = noteSnapshot(note)
    setSaveByNote((prev) => ({ ...prev, [note.id]: 'saved' }))
  }, [])

  const markNoteDirty = useCallback((id: string) => {
    setSaveByNote((prev) => ({ ...prev, [id]: 'dirty' }))
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
        setOpenNotes((prev) => ({ ...prev, [note.id]: saved }))
        setSummaries((prev) => [toSummary(saved), ...prev.filter((s) => s.id !== saved.id)])
        markNoteSaved(saved)
        if (!opts?.silent) setStatusMessage(t('notebook.saved'))
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
      if (openNotes[id]) {
        setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
        setActiveTabId(id)
        return
      }
      const note = (await api.getNote(id)) as Note
      markNoteSaved(note)
      setOpenNotes((prev) => ({ ...prev, [id]: note }))
      setSummaries((prev) => {
        const sum = toSummary(note)
        if (prev.some((s) => s.id === id)) return prev
        return [sum, ...prev]
      })
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setActiveTabId(id)
    },
    [openNotes, markNoteSaved],
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
      } else if (evt.op === 'delete' && noteId) {
        setOpenTabIds((prev) => prev.filter((id) => id !== noteId))
        setOpenNotes((prev) => {
          const next = { ...prev }
          delete next[noteId]
          return next
        })
        setActiveTabId((cur) => (cur === noteId ? null : cur))
      } else if (noteId && openNotes[noteId] && evt.op !== 'delete') {
        try {
          const note = (await api.getNote(noteId)) as Note
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
  }, [refreshSummaries, refreshAll, openNoteById, openNotes, markNoteSaved])

  useEffect(() => {
    if (!notebookFocusNoteId || loading) return
    void openNoteById(notebookFocusNoteId)
      .then(() => refreshSummaries())
      .finally(() => setNotebookFocusNoteId(null))
  }, [notebookFocusNoteId, loading, openNoteById, setNotebookFocusNoteId, refreshSummaries])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      try {
        await refreshAll()
        const ui = await api.getNotebookUI()
        const tabIds = ui.openTabIds ?? []
        const loaded: Record<string, Note> = {}
        for (const id of tabIds) {
          try {
            loaded[id] = (await api.getNote(id)) as Note
          } catch {
            /* 跳过已删除笔记 */
          }
        }
        const validIds = tabIds.filter((id) => loaded[id])
        setOpenNotes(loaded)
        for (const n of Object.values(loaded)) markNoteSaved(n)
        setOpenTabIds(validIds)
        setActiveTabId(ui.activeTabId && loaded[ui.activeTabId] ? ui.activeTabId : validIds[0] ?? null)
      } catch (e) {
        setStatusMessage((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [refreshAll, setStatusMessage, markNoteSaved])

  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => {
      void refreshSummaries().catch((e) => setStatusMessage((e as Error).message))
    }, 300)
    return () => clearTimeout(t)
  }, [search, loading, refreshSummaries, setStatusMessage])

  useEffect(() => {
    if (loading) return
    persistUI(openTabIds, activeTabId)
  }, [openTabIds, activeTabId, loading, persistUI])

  useWorkbenchCommand(Capability.NotebookOpen, (cmd) => {
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
        void persistNote(note, { silent: true })
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

  const updateActiveNote = (patch: Partial<Note>) => {
    if (!activeTabId || !activeNote) return
    const nextPatch = { ...patch }
    if (nextPatch.groupId !== undefined && nextPatch.groupId !== activeNote.groupId) {
      nextPatch.sortOrder = nextNoteSortOrder(
        summaries.filter((s) => s.id !== activeTabId),
        nextPatch.groupId,
      )
    }
    const next = { ...activeNote, ...nextPatch }
    setOpenNotes((prev) => ({ ...prev, [activeTabId]: next }))
    markNoteDirty(activeTabId)
    scheduleSave(next)
  }

  /** createNote 新建笔记；未传 groupId 时建在根目录。 */
  const createNote = async (groupId = '') => {
    try {
      const saved = (await api.saveNote(
        model.NoteDO.createFrom({
          id: '',
          groupId,
          title: t('common.unnamed'),
          content: '',
          language: 'plaintext',
          sshHostId: '',
          connectionId: '',
          sortOrder: nextNoteSortOrder(summaries, groupId),
          createdAt: 0,
          updatedAt: 0,
        })
      )) as Note
      setSummaries((prev) => [...prev, toSummary(saved)])
      markNoteSaved(saved)
      await openNoteById(saved.id)
      setStatusMessage(t('notebook.created'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
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
    const saved = (await api.saveNotebookGroup(
      model.NotebookGroupDO.createFrom({ id: '', name, parentId: '', sortOrder: groups.length, createdAt: 0, updatedAt: 0 })
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
      openProductLink({ action: 'terminal', hostId: activeNote.sshHostId, initialCommand: command })
    } else {
      openProductLink({ action: 'terminal', localShell: true, initialCommand: command })
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
    openProductLink({
      action: 'database',
      connectionId: activeNote.connectionId,
      initialSql: sql || undefined,
      runSql: runSql && Boolean(sql),
    })
  }

  /** onConnectionLinkChange 关联数据库连接，并同步 SSH 跳板主机。 */
  const onConnectionLinkChange = (connectionId: string) => {
    const conn = connectionId ? connections.find((c) => c.id === connectionId) : undefined
    const patch: Partial<Note> = { connectionId }
    if (conn?.sshHostId) patch.sshHostId = conn.sshHostId
    updateActiveNote(patch)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.kind === 'note') {
        await api.deleteNote(deleteTarget.id)
        setSummaries((prev) => prev.filter((s) => s.id !== deleteTarget.id))
        setOpenTabIds((prev) => prev.filter((id) => id !== deleteTarget.id))
        setOpenNotes((prev) => {
          const next = { ...prev }
          delete next[deleteTarget.id]
          return next
        })
        if (activeTabId === deleteTarget.id) setActiveTabId(null)
      } else {
        await api.deleteNotebookGroup(deleteTarget.id)
        await refreshAll()
      }
      setStatusMessage(t('notebook.deleted'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setDeleteTarget(null)
    }
  }

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  const moveNoteToGroup = useCallback(
    async (noteId: string, groupId: string) => {
      const nextSummaries = moveNoteInTree(summaries, noteId, groupId, null)
      await persistNotebookLayout(buildNotebookLayout(groups, nextSummaries))
      if (openNotes[noteId]) {
        setOpenNotes((prev) => ({
          ...prev,
          [noteId]: { ...prev[noteId], groupId },
        }))
      }
    },
    [summaries, groups, persistNotebookLayout, openNotes],
  )

  if (loading) {
    return (
      <div className="product-workbench notebook-workbench">
        <div className="pane-empty">{t('notebook.loading')}</div>
      </div>
    )
  }

  return (
    <div className="product-workbench notebook-workbench">
      <header className="product-toolbar">
        <div className="product-actions">
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" {...pressProps(() => void createNote())}>
            <IconPlus size={14} /> {t('notebook.newNote')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => setGroupModal(null))}>
            {t('notebook.newGroup')}
          </button>
          {activeNote && (
            <>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(insertTemplate)}>
                {t('notebook.insertTemplate')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void duplicateNote())}>
                {t('notebook.duplicate')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void exportNote())}>
                {t('notebook.export')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(runInTerminal)}>
                <IconPlay size={14} /> {t('notebook.runTerminal')}
              </button>
              {activeNote.connectionId && (
                <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => openDatabase(true))}>
                  <IconDatabase size={14} /> {t('notebook.openAndRun')}
                </button>
              )}
              {activeNote.language === 'markdown' && (
                <button
                  type="button"
                  className={`wn-btn wn-btn-sm wn-btn-tool ${showPreview ? 'active' : ''}`}
                  {...pressProps(() => setShowPreview((v) => !v))}
                >
                  {t('notebook.preview')}
                </button>
              )}
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-tool wn-btn-danger"
                {...pressProps(() => setDeleteTarget({ kind: 'note', id: activeNote.id, title: activeNote.title }))}
              >
                {t('common.delete')}
              </button>
            </>
          )}
        </div>
        <div className="product-toolbar-status">
          <IconNotebook size={14} />
          <span>{t('notebook.noteCount', { count: summaries.length })}</span>
        </div>
      </header>

      <div className="product-body">
        <NotebookSidebar
          groups={groups}
          summaries={summaries}
          searching={searching}
          search={search}
          activeTabId={activeTabId}
          collapsedGroups={collapsedGroups}
          languages={languages}
          onSearchChange={setSearch}
          onToggleGroup={toggleGroup}
          onOpenNote={(id) => void openNoteById(id)}
          onGroupsChange={setGroups}
          onSummariesChange={setSummaries}
          onPersistLayout={persistNotebookLayout}
          onCreateNoteInGroup={(gid) => void createNote(gid)}
          onEditGroup={setGroupModal}
          onDeleteGroup={(id, title) => setDeleteTarget({ kind: 'group', id, title })}
          onDeleteNote={(id, title) => setDeleteTarget({ kind: 'note', id, title })}
          onMoveNoteToGroup={(noteId, groupId) => void moveNoteToGroup(noteId, groupId)}
        />

        <main className="app-main notebook-main">
          <div className="editor-chrome">
            <div className="wn-tabs" ref={tabsRef}>
              {openTabIds.map((id) => {
                const note = openNotes[id]
                if (!note) return null
                return (
                  <button
                    key={id}
                    type="button"
                    data-tab-id={id}
                    className={`wn-tab ${id === activeTabId ? 'active' : ''}`}
                    {...pressProps(() => setActiveTabId(id))}
                    onContextMenu={(e) => openTabContextMenu(e, id, setTabCtxMenu, setActiveTabId)}
                  >
                    <span className="tab-title">{note.title}</span>
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
              <div className="notebook-meta-bar">
                <input
                  className="notebook-title-input"
                  value={activeNote.title}
                  onChange={(e) => updateActiveNote({ title: e.target.value })}
                  placeholder={t('notebook.titlePlaceholder')}
                />
                <Select
                  className="notebook-lang-select"
                  value={activeNote.groupId}
                  title={t('notebook.groupTitle')}
                  options={[
                    { value: '', label: t('notebook.rootGroup') },
                    ...groups.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                  onChange={(v) => updateActiveNote({ groupId: v })}
                />
                <Select
                  className="notebook-lang-select"
                  value={activeNote.language}
                  options={languages.map((l) => ({ value: l.id, label: l.label }))}
                  onChange={(v) => updateActiveNote({ language: v as NoteLanguage })}
                />
                <Select
                  className="notebook-host-select"
                  value={activeNote.sshHostId}
                  options={[
                    { value: '', label: t('notebook.sshHost') },
                    ...hosts.map((h) => ({
                      value: h.id,
                      label: h.kind === 'docker' ? `[Docker] ${h.name}` : h.name,
                    })),
                  ]}
                  onChange={(v) => updateActiveNote({ sshHostId: v })}
                />
                <Select
                  className="notebook-host-select"
                  value={activeNote.connectionId}
                  title={t('notebook.dbLinkHint')}
                  options={[
                    { value: '', label: t('notebook.dbConnection') },
                    ...connections.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  onChange={onConnectionLinkChange}
                />
                {activeNote.sshHostId && (
                  <span className="notebook-host-badge">
                    {hosts.find((h) => h.id === activeNote.sshHostId)?.kind === 'docker' ? (
                      <><IconDocker size={12} /> Docker</>
                    ) : (
                      <><IconServer size={12} /> SSH</>
                    )}
                  </span>
                )}
                <div className="notebook-save-actions">
                  <button
                    type="button"
                    className={`wn-btn wn-btn-sm ${activeSaveStatus === 'dirty' ? 'wn-btn-primary' : 'wn-btn-tool'}`}
                    disabled={activeSaveStatus === 'saving'}
                    title={t('notebook.saveShortcut')}
                    {...pressProps(() => void flushSaveActive(), { disabled: activeSaveStatus === 'saving' })}
                  >
                    {activeSaveStatus === 'saving' ? t('notebook.saving') : t('notebook.save')}
                  </button>
                  <span
                    className={`notebook-save-status${activeSaveStatus === 'dirty' ? ' is-dirty' : ''}`}
                    aria-live="polite"
                  >
                    {activeSaveStatus === 'saving'
                      ? t('notebook.saving')
                      : activeSaveStatus === 'dirty'
                        ? t('notebook.unsaved')
                        : t('notebook.saved')}
                  </span>
                </div>
              </div>
              <div className={`notebook-editor-split${showPreview ? ' with-preview' : ''}`}>
                <NoteEditor
                  ref={editorRef}
                  noteId={activeNote.id}
                  language={activeNote.language}
                  content={activeNote.content}
                  onChange={(content) => updateActiveNote({ content })}
                  onRunSelection={runInTerminal}
                />
                {showPreview && activeNote.language === 'markdown' && (
                  <div className="notebook-preview-pane">
                    <MarkdownPreview content={activeNote.content} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="pane-empty"><span>{t('notebook.emptyWorkspace')}</span></div>
          )}
        </main>
      </div>

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

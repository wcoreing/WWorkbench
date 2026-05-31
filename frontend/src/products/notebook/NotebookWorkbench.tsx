import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Connection, Note, NoteLanguage, NoteSummary, NotebookGroup, SSHHost } from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { IconDatabase, IconNotebook, IconPlay, IconPlus, IconServer } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MarkdownPreview } from '../../features/notebook/MarkdownPreview'
import { NoteEditor, type NoteEditorHandle } from '../../features/notebook/NoteEditor'
import { NotebookGroupModal } from '../../features/notebook/NotebookGroupModal'
import {
  buildConnectionTemplate,
  buildServerChecklistTemplate,
  buildSSHHostTemplate,
  extractRunCommands,
  extractSqlText,
} from '../../features/notebook/noteTemplates'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { openProductLink, useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'

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
  const { setStatusMessage, setActiveProduct } = useAppStore()
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
  const [hosts, setHosts] = useState<SSHHost[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'note' | 'group'; id: string; title: string } | null>(null)
  const [groupModal, setGroupModal] = useState<NotebookGroup | null | undefined>(undefined)
  const [showPreview, setShowPreview] = useState(false)
  const editorRef = useRef<NoteEditorHandle>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const booted = useRef(false)

  const activeNote = activeTabId ? openNotes[activeTabId] ?? null : null
  const searching = Boolean(search.trim())

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
      api.listSSHHosts(),
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

  const openNoteById = useCallback(async (id: string) => {
    if (openNotes[id]) {
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      setActiveTabId(id)
      return
    }
    const note = (await api.getNote(id)) as Note
    setOpenNotes((prev) => ({ ...prev, [id]: note }))
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setActiveTabId(id)
  }, [openNotes])

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
        setOpenTabIds(validIds)
        setActiveTabId(ui.activeTabId && loaded[ui.activeTabId] ? ui.activeTabId : validIds[0] ?? null)
      } catch (e) {
        setStatusMessage((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [refreshAll, setStatusMessage])

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
        const { groupList, hostList, connList } = await refreshAll()
        const groupId = groupList[0]?.id ?? ''
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
          content = content || buildSSHHostTemplate(host)
        }

        const saved = (await api.saveNote(
          model.NoteDO.createFrom({
            id: '',
            groupId,
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
        await refreshSummaries()
        await openNoteById(saved.id)
        setStatusMessage(t('notebook.createdNote', { title: saved.title }))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  })

  const scheduleSave = (note: Note) => {
    if (saveTimers.current[note.id]) clearTimeout(saveTimers.current[note.id])
    saveTimers.current[note.id] = setTimeout(() => {
      void (async () => {
        try {
          const saved = (await api.saveNote(toNoteDO(note))) as Note
          setOpenNotes((prev) => ({ ...prev, [note.id]: saved }))
          setSummaries((prev) => [toSummary(saved), ...prev.filter((s) => s.id !== saved.id)])
        } catch (e) {
          setStatusMessage((e as Error).message)
        }
      })()
    }, 400)
  }

  const updateActiveNote = (patch: Partial<Note>) => {
    if (!activeTabId || !activeNote) return
    const next = { ...activeNote, ...patch }
    setOpenNotes((prev) => ({ ...prev, [activeTabId]: next }))
    scheduleSave(next)
  }

  const createNote = async (groupId?: string) => {
    const gid = groupId ?? groups[0]?.id
    if (!gid) return
    try {
      const saved = (await api.saveNote(
        model.NoteDO.createFrom({
          id: '',
          groupId: gid,
          title: t('common.unnamed'),
          content: '',
          language: 'plaintext',
          sshHostId: '',
          connectionId: '',
          sortOrder: 0,
          createdAt: 0,
          updatedAt: 0,
        })
      )) as Note
      setSummaries((prev) => [toSummary(saved), ...prev])
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
    else if (host) block = buildSSHHostTemplate(host)
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

  const renderNoteItem = (n: NoteSummary) => (
    <li
      key={n.id}
      className={`conn-item ${activeTabId === n.id ? 'active' : ''}`}
      onClick={() => void openNoteById(n.id)}
    >
      <IconNotebook size={14} className="mock-icon" />
      <div className="conn-meta">
        <span className="conn-name">{n.title}</span>
        <span className="conn-host">
          {languages.find((l) => l.id === n.language)?.label}
          {n.sshHostId ? ' · SSH' : ''}
          {n.connectionId ? ' · DB' : ''}
        </span>
      </div>
    </li>
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
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={() => void createNote()}>
            <IconPlus size={14} /> {t('notebook.newNote')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => setGroupModal(null)}>
            {t('notebook.newGroup')}
          </button>
          {activeNote && (
            <>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={insertTemplate}>
                {t('notebook.insertTemplate')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => void duplicateNote()}>
                {t('notebook.duplicate')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => void exportNote()}>
                {t('notebook.export')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={runInTerminal}>
                <IconPlay size={14} /> {t('notebook.runTerminal')}
              </button>
              {activeNote.connectionId && (
                <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => openDatabase(true)}>
                  <IconDatabase size={14} /> {t('notebook.openAndRun')}
                </button>
              )}
              {activeNote.language === 'markdown' && (
                <button
                  type="button"
                  className={`wn-btn wn-btn-sm wn-btn-tool ${showPreview ? 'active' : ''}`}
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {t('notebook.preview')}
                </button>
              )}
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-tool wn-btn-danger"
                onClick={() => setDeleteTarget({ kind: 'note', id: activeNote.id, title: activeNote.title })}
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
        <aside className="app-sidebar notebook-sidebar">
          <div className="notebook-search">
            <input
              type="search"
              placeholder={t('notebook.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {searching ? (
            <section className="sidebar-section">
              <div className="sidebar-header">
                <span>{t('notebook.searchResults', { count: summaries.length })}</span>
              </div>
              <div className="sidebar-body">
                {summaries.length === 0 ? (
                  <div className="empty-hint">{t('notebook.noMatch')}</div>
                ) : (
                  <ul className="conn-list notebook-note-list">{summaries.map(renderNoteItem)}</ul>
                )}
              </div>
            </section>
          ) : (
            groups.map((g) => {
              const notes = summaries.filter((n) => n.groupId === g.id)
              const collapsed = collapsedGroups.has(g.id)
              return (
                <section key={g.id} className="sidebar-section">
                  <div className="sidebar-header notebook-group-header">
                    <button type="button" className="notebook-group-toggle" onClick={() => toggleGroup(g.id)}>
                      {collapsed ? '▸' : '▾'} {g.name}
                    </button>
                    <button
                      type="button"
                      className="wn-btn wn-btn-icon wn-btn-sm"
                      title={t('notebook.renameGroup')}
                      onClick={() => setGroupModal(g)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="wn-btn wn-btn-icon wn-btn-sm"
                      title={t('notebook.newInGroup')}
                      onClick={() => void createNote(g.id)}
                    >
                      <IconPlus size={14} />
                    </button>
                    <button
                      type="button"
                      className="wn-btn wn-btn-icon wn-btn-sm notebook-group-delete"
                      title={t('notebook.deleteGroup')}
                      onClick={() => setDeleteTarget({ kind: 'group', id: g.id, title: g.name })}
                    >
                      ×
                    </button>
                  </div>
                  {!collapsed && (
                    <div className="sidebar-body">
                      {notes.length === 0 ? (
                        <div className="empty-hint">{t('notebook.noNotes')}</div>
                      ) : (
                        <ul className="conn-list notebook-note-list">{notes.map(renderNoteItem)}</ul>
                      )}
                    </div>
                  )}
                </section>
              )
            })
          )}
        </aside>

        <main className="app-main notebook-main">
          <div className="editor-chrome">
            <div className="wn-tabs">
              {openTabIds.map((id) => {
                const note = openNotes[id]
                if (!note) return null
                return (
                  <button
                    key={id}
                    type="button"
                    className={`wn-tab ${id === activeTabId ? 'active' : ''}`}
                    onClick={() => setActiveTabId(id)}
                  >
                    <span className="tab-title">{note.title}</span>
                    <span className="wn-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(id) }}>×</span>
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
                <select
                  className="notebook-lang-select"
                  value={activeNote.groupId}
                  onChange={(e) => updateActiveNote({ groupId: e.target.value })}
                  title={t('notebook.groupTitle')}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <select
                  className="notebook-lang-select"
                  value={activeNote.language}
                  onChange={(e) => updateActiveNote({ language: e.target.value as NoteLanguage })}
                >
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
                <select
                  className="notebook-host-select"
                  value={activeNote.sshHostId}
                  onChange={(e) => updateActiveNote({ sshHostId: e.target.value })}
                >
                  <option value="">{t('notebook.sshHost')}</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
                <select
                  className="notebook-host-select"
                  value={activeNote.connectionId}
                  onChange={(e) => onConnectionLinkChange(e.target.value)}
                  title={t('notebook.dbLinkHint')}
                >
                  <option value="">{t('notebook.dbConnection')}</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {activeNote.sshHostId && (
                  <span className="notebook-host-badge"><IconServer size={12} /> SSH</span>
                )}
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

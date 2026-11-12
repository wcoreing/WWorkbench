import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type {
  Connection,
  HostProject,
  Note,
  NoteLanguage,
  NoteSummary,
  NotebookGroup,
  ShellHost,
} from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ProductLayout, rememberScalarSize, recallScalarSize, useResizable } from '../../components/layout'
import { TabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'
import { type NotebookMdViewMode } from '../../features/notebook/NotebookMdViewToggle'
import { breadcrumbLabels } from '../../features/notebook/notebookPath'
import {
  clampNotebookEditorFontSize,
  DEFAULT_NOTEBOOK_EDITOR_FONT,
  NOTEBOOK_EDITOR_FONT_SETTING_KEY,
  type NotebookEditorFontSize,
} from '../../features/notebook/notebookEditorFont'
import { saveAppSetting } from '../../stores/appPreferences'
import type { NoteEditorHandle } from '../../features/notebook/NoteEditor'
import { NotebookNewFileModal } from '../../features/notebook/NotebookNewFileModal'
import { ComposeBriefModal } from '../../features/notebook/ComposeBriefModal'
import {
  NOTEBOOK_ROOT_OPS,
  notebookRootsFor,
  primaryNotebookRoot,
} from '../../features/notebook/businessRoots'
import { NotebookSidebar } from '../../features/notebook/NotebookSidebar'
import {
  NOTE_FILE_TYPE_PRESETS,
  isMarkdownLikeLanguage,
} from '../../features/notebook/noteFileTypes'
import { adoptNoteLanguage } from '../../features/notebook/noteModel'
import { useNotebookNotePersistence } from '../../features/notebook/useNotebookNotePersistence'
import { useNotebookNoteRole } from '../../features/notebook/useNotebookNoteRole'
import { useNotebookPathOps } from '../../features/notebook/useNotebookPathOps'
import { useNotebookComposeBrief } from '../../features/notebook/useNotebookComposeBrief'
import { useNotebookWorkbenchSession } from '../../features/notebook/useNotebookWorkbenchSession'
import { useNotebookWorkbenchActions } from '../../features/notebook/useNotebookWorkbenchActions'
import { useDismissOverlays } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'
import { useLoading, withLoading } from '../../stores/loadingStore'
import {
  buildConnectionTemplate,
  buildShellHostTemplate,
} from '../../features/notebook/noteTemplates'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { useAppStore } from '../../stores/appStore'
import { buildNotebookSurface, briefList } from '../../stores/agentSurface'
import { useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { useScrollActiveTabIntoView } from '../../hooks/useScrollActiveTabIntoView'
import { NotebookWorkbenchEditorPane } from './NotebookWorkbenchEditorPane'

/** NotebookWorkbench 笔记本产品线工作区。 */
export function NotebookWorkbench() {
  const { t } = useI18n()
  const setStatusMessage = useAppStore((s) => s.setStatusMessage)
  const setActiveProduct = useAppStore((s) => s.setActiveProduct)
  const activeProduct = useAppStore((s) => s.activeProduct)
  const notebookFocusNoteId = useAppStore((s) => s.notebookFocusNoteId)
  const setNotebookFocusNoteId = useAppStore((s) => s.setNotebookFocusNoteId)
  const notebookFocusFolderId = useAppStore((s) => s.notebookFocusFolderId)
  const setNotebookFocusFolderId = useAppStore((s) => s.setNotebookFocusFolderId)
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
  const [projectByDir, setProjectByDir] = useState<Record<string, HostProject>>({})
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
  /** 运维壳：记忆区 + 运维（不露工作流）。 */
  const opsRoots = notebookRootsFor('notebook')
  const opsRoot = primaryNotebookRoot('notebook') || NOTEBOOK_ROOT_OPS
  /** selectedFolderId 侧栏当前选中目录；默认落在运维工作根。 */
  const [selectedFolderId, setSelectedFolderId] = useState(opsRoot)
  const [mdViewMode, setMdViewMode] = useState<NotebookMdViewMode>('source')
  const [editorFontSize, setEditorFontSize] = useState<NotebookEditorFontSize>(DEFAULT_NOTEBOOK_EDITOR_FONT)
  const [saveByNote, setSaveByNote] = useState<Record<string, 'saved' | 'dirty' | 'saving'>>({})
  const [tabCtxMenu, setTabCtxMenu] = useState<TabContextMenuState | null>(null)
  useDismissOverlays(() => setTabCtxMenu(null))
  const editorRef = useRef<NoteEditorHandle>(null)

  const activeNote = activeTabId ? openNotes[activeTabId] ?? null : null
  const activeSaveStatus = activeTabId ? saveByNote[activeTabId] ?? 'saved' : 'saved'
  const {
    openNotesRef,
    saveByNoteRef,
    markNoteSaved,
    markNoteDirty,
    openNoteById,
    flushSaveActive,
    updateActiveNote,
    clearNoteLocalState,
  } = useNotebookNotePersistence({
    openNotes,
    saveByNote,
    activeTabId,
    activeNote,
    activeSaveStatus,
    summaries,
    setOpenNotes,
    setSummaries,
    setOpenTabIds,
    setActiveTabId,
    setSaveByNote,
    t,
  })
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

  const refreshSummaries = useCallback(async () => {
    const list = searching
      ? ((await api.searchNotes(search.trim())) as NoteSummary[])
      : ((await api.listNotes()) as NoteSummary[])
    setSummaries(list)
  }, [search, searching])

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.listHostProjects('')
      const map: Record<string, HostProject> = {}
      for (const p of list) {
        if (p.dirRel) map[p.dirRel] = p
      }
      setProjectByDir(map)
    } catch {
      /* 项目绑定为增强信息 */
    }
  }, [])

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
    void refreshProjects()
    return {
      groupList: groupList as NotebookGroup[],
      noteList: noteList as NoteSummary[],
      hostList,
      connList: connList as Connection[],
    }
  }, [refreshProjects])

  const {
    applyPathMutation,
    renameNotebookPath,
    moveNotebookPath,
    copyNotebookPath,
    createDirInline,
    createFileInline,
    confirmDelete: confirmDeletePath,
  } = useNotebookPathOps({
    refreshAll,
    openNoteById,
    setOpenTabIds,
    setActiveTabId,
    setSelectedFolderId,
    setOpenNotes,
    setSaveByNote,
    setSummaries,
    activeTabId,
    selectedFolderId,
    t,
  })

  const {
    briefSourceIds,
    setBriefSourceIds,
    submitComposeBrief,
    briefDefaultTitle,
  } = useNotebookComposeBrief({
    groups,
    summaries,
    refreshAll,
    openNoteById,
    markNoteSaved,
    setSummaries,
    setSelectedFolderId,
    setMdViewMode,
    t,
  })

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
          notify.success(t('notebook.listRefreshed'))
        },
        {
          label: t('common.loading'),
          onBegin: () => setSummaries([]),
        },
      )
    } catch (e) {
      notify.error((e as Error).message)
    }
  }, [
    refreshAll,
    refreshSummaries,
    searching,
    openTabIds,
    saveByNote,
    markNoteSaved,
    t,
  ])

  const { bootReady } = useNotebookWorkbenchSession({
    bootLoadingActive: bootLoading.active,
    search,
    openTabIds,
    activeTabId,
    openNotesRef,
    saveByNoteRef,
    refreshAll,
    refreshSummaries,
    openNoteById,
    markNoteSaved,
    applyPathMutation,
    setOpenTabIds,
    setActiveTabId,
    setOpenNotes,
    setSaveByNote,
    setSummaries,
    setGroups,
    setSelectedFolderId,
    notebookFocusNoteId,
    setNotebookFocusNoteId,
    notebookFocusFolderId,
    setNotebookFocusFolderId,
    t,
  })

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
        .catch((e) => notify.error((e as Error).message))
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

        // SSH 主机：打开/成册主机记忆册（Docker 等非 SSH 仍走普通笔记）
        const bookHostId =
          host?.kind === 'ssh'
            ? host.id
            : conn?.sshHostId
              ? String(conn.sshHostId)
              : ''
        if (bookHostId && !initialCommand) {
          const book = await api.ensureHostMemoryBook(bookHostId)
          setSelectedFolderId(book.dirRel)
          setNotebookFocusFolderId(book.dirRel)
          await refreshAll()
          await openNoteById(book.noteId)
          notify.success(
            book.created
              ? t('notebook.hostBookCreated', { path: book.dirRel })
              : t('notebook.hostBookOpened', { path: book.dirRel }),
          )
          return
        }

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
        notify.success(t('notebook.createdNote', { title: saved.title }))
      } catch (e) {
        notify.error((e as Error).message)
      }
    })()
  })

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

  const { makeNoteRole } = useNotebookNoteRole({
    activeNote,
    openNotes,
    setOpenNotes,
    setSummaries,
    setSaveByNote,
    refreshAll,
    t,
  })


  const {
    openCreateFile,
    createFile,
    duplicateNote,
    exportNote,
    revealNoteInFinder,
    patchActiveNoteSettings,
    insertTemplate,
    insertFilesAsAssets,
    pickAssets,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    runInTerminal,
    openDatabase,
    onConnectionLinkChange,
    handleBatchDeleteNotes,
  } = useNotebookWorkbenchActions({
    activeNote,
    activeTabId,
    summaries,
    groups,
    hosts,
    connections,
    editorRef,
    opsRoot,
    refreshAll,
    openNoteById,
    markNoteSaved,
    markNoteDirty,
    updateActiveNote,
    clearNoteLocalState,
    setOpenTabIds,
    setActiveTabId,
    setOpenNotes,
    setSaveByNote,
    setSummaries,
    setGroups,
    setNewFileGroupId,
    setStatusMessage,
    t,
  })

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
            scopeRootIds={opsRoots}
            groups={groups}
            summaries={summaries}
            search={search}
            activeTabId={activeTabId}
            selectedFolderId={selectedFolderId || opsRoot}
            roleFilter={notebookRoleFilter}
            onRoleFilterChange={(role) => setNotebookRoleFilter(role as '' | 'memory' | 'skill')}
            onSelectFolder={setSelectedFolderId}
            onSearchChange={setSearch}
            onOpenNote={(id) => {
              const note = summaries.find((n) => n.id === id)
              if (note) setSelectedFolderId(note.groupId || opsRoot)
              void openNoteById(id)
            }}
            onDeleteGroup={(id, title) => setDeleteTarget({ kind: 'group', id, title })}
            onDeleteNote={(id, title) => setDeleteTarget({ kind: 'note', id, title })}
            onMakeNoteRole={(noteId, role) => void makeNoteRole(noteId, role)}
            onBatchDelete={handleBatchDeleteNotes}
            onRefresh={handleRefreshList}
            onRevealWorkspace={() => void revealNoteInFinder('')}
            onRevealPath={(rel) => void api.revealNotebookPath(rel).then(() => notify.info(t('notebook.revealedInFinder')))}
            onRenamePath={renameNotebookPath}
            onMovePath={moveNotebookPath}
            onCopyPath={copyNotebookPath}
            onCreateDirInline={createDirInline}
            onCreateFileInline={createFileInline}
            refreshing={listLoading.active}
            projectByDir={projectByDir}
            onProjectBindingChanged={refreshProjects}
            onComposeBrief={(ids) => setBriefSourceIds(ids)}
          />
        }
      >
        <NotebookWorkbenchEditorPane
          tabsRef={tabsRef}
          openTabIds={openTabIds}
          openNotes={openNotes}
          activeTabId={activeTabId}
          saveByNote={saveByNote}
          setActiveTabId={setActiveTabId}
          setTabCtxMenu={setTabCtxMenu}
          closeTab={closeTab}
          activeNote={activeNote}
          activeCrumbs={activeCrumbs}
          noteMdLike={noteMdLike}
          mdViewMode={mdViewMode}
          setMdViewMode={setMdViewMode}
          noteEditorSplitClass={noteEditorSplitClass}
          showNoteEditor={showNoteEditor}
          showNotePreview={showNotePreview}
          editorRef={editorRef}
          editorFontSize={editorFontSize}
          onEditorFontSizeChange={onEditorFontSizeChange}
          updateActiveNote={updateActiveNote}
          runInTerminal={runInTerminal}
          insertFilesAsAssets={insertFilesAsAssets}
          pickAssets={pickAssets}
          insertTemplate={insertTemplate}
          duplicateNote={duplicateNote}
          exportNote={exportNote}
          revealNoteInFinder={revealNoteInFinder}
          openDatabase={openDatabase}
          onDeleteActive={() =>
            activeNote &&
            setDeleteTarget({ kind: 'note', id: activeNote.id, title: activeNote.title })
          }
          groups={groups}
          hosts={hosts}
          connections={connections}
          languages={languages}
          patchActiveNoteSettings={patchActiveNoteSettings}
          onConnectionLinkChange={onConnectionLinkChange}
          settingsOpenSignal={settingsOpenSignal}
          setSettingsOpenSignal={setSettingsOpenSignal}
          activeSaveStatus={activeSaveStatus}
          flushSaveActive={flushSaveActive}
          activeHostName={activeHostName}
          activeConnName={activeConnName}
          openCreateFile={() => openCreateFile(selectedFolderId || opsRoot)}
        />
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

      <ComposeBriefModal
        open={briefSourceIds !== null}
        sourceCount={briefSourceIds?.length ?? 0}
        defaultTitle={briefDefaultTitle}
        onClose={() => setBriefSourceIds(null)}
        onSubmit={submitComposeBrief}
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
        onConfirm={() => {
          if (!deleteTarget) return
          void confirmDeletePath(deleteTarget, () => setDeleteTarget(null))
        }}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  )
}

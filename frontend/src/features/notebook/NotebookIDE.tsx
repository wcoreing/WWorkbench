import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from '../../api/client'
import type { Note, NoteRole, NoteSummary, NotebookGroup } from '../../api/types'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { pressProps } from '../../components/compat'
import { NoteEditor } from './NoteEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { NotebookMdViewToggle, type NotebookMdViewMode } from './NotebookMdViewToggle'
import { NotebookSidebar } from './NotebookSidebar'
import { NotebookStatusBar } from './NotebookStatusBar'
import { applyNoteRoleFields } from './noteFrontmatter'
import { isMarkdownLikeLanguage } from './noteFileTypes'
import { adoptNoteLanguage, skillEntryNoteId, toNoteDO, toSummary } from './noteModel'
import { findNotebookSubtree, buildNotebookTree } from './notebookTree'
import { askConfirm } from '../../utils/askConfirm'

export type NotebookIDEHandle = {
  refresh: () => Promise<void>
  openNote: (id: string) => Promise<void>
}

type Props = {
  /** 只展示并编辑该目录（如 工作流/小红书发布）；空则显示 emptyHint。 */
  scopeRootId: string
  title?: string
  emptyHint?: string
  className?: string
  /** scope 就绪后优先打开的笔记（如 log.md）；默认 SKILL.md。 */
  preferredNoteId?: string
  /** scope 就绪后自动打开入口文件。 */
  autoOpenEntry?: boolean
  treeWidth?: number
  /** 宿主已自管文件树（如任务左栏）时隐藏内嵌侧栏，只留编辑器。 */
  hideTree?: boolean
}

/**
 * NotebookIDE：同一套 NotebookSidebar + 编辑器（禁止另开精简树）。
 * 宿主只需传 scopeRootId；hideTree 时由宿主树驱动 openNote。
 */
export const NotebookIDE = forwardRef<NotebookIDEHandle, Props>(function NotebookIDE(
  {
    scopeRootId,
    title,
    emptyHint,
    className = '',
    preferredNoteId,
    autoOpenEntry = true,
    treeWidth = 220,
    hideTree = false,
  },
  ref,
) {
  const { t } = useI18n()
  const [groups, setGroups] = useState<NotebookGroup[]>([])
  const [summaries, setSummaries] = useState<NoteSummary[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [mdViewMode, setMdViewMode] = useState<NotebookMdViewMode>('source')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'' | NoteRole>('')
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  noteRef.current = note

  const scopeLabel = useMemo(() => {
    if (title) return title
    if (!scopeRootId) return ''
    return scopeRootId.split('/').filter(Boolean).pop() || scopeRootId
  }, [title, scopeRootId])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [g, n] = await Promise.all([api.listNotebookGroups(), api.listNotes()])
      setGroups(g as NotebookGroup[])
      setSummaries(n as NoteSummary[])
    } finally {
      setRefreshing(false)
    }
  }, [])

  const openNote = useCallback(async (id: string) => {
    if (!id) return
    setBusy(true)
    try {
      const raw = (await api.getNote(id)) as Note
      const adopted = adoptNoteLanguage(raw)
      setNote(adopted)
      setSaveStatus('saved')
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useImperativeHandle(ref, () => ({ refresh, openNote }), [refresh, openNote])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    if (scopeRootId) setSelectedFolderId(scopeRootId)
  }, [scopeRootId])

  useEffect(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    setNote(null)
    setSaveStatus('saved')
    if (!scopeRootId || !autoOpenEntry) return
    let cancelled = false
    void (async () => {
      try {
        await refresh()
      } catch {
        /* ignore */
      }
      if (cancelled) return
      const preferred = (preferredNoteId || '').trim()
      const entry = preferred || skillEntryNoteId(scopeRootId)
      try {
        await openNote(entry)
      } catch {
        if (preferred && preferred !== skillEntryNoteId(scopeRootId)) {
          try {
            await openNote(skillEntryNoteId(scopeRootId))
          } catch {
            /* 尚无入口文件 */
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [scopeRootId, preferredNoteId, autoOpenEntry, refresh, openNote])

  const scopeExists = useMemo(() => {
    if (!scopeRootId) return false
    const tree = buildNotebookTree(groups, summaries)
    return Boolean(findNotebookSubtree(tree, scopeRootId))
  }, [groups, summaries, scopeRootId])

  const persist = useCallback(
    async (n: Note, silent = true) => {
      setSaveStatus('saving')
      try {
        const saved = adoptNoteLanguage((await api.saveNote(toNoteDO(n))) as Note)
        const current = noteRef.current
        if (current && current.id === n.id && current.content !== n.content) {
          setNote({ ...current, updatedAt: saved.updatedAt })
          setSaveStatus('dirty')
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => {
            const again = noteRef.current
            if (again) void persist(again, true)
          }, 400)
          return
        }
        setNote(saved)
        setSummaries((prev) => [toSummary(saved), ...prev.filter((s) => s.id !== saved.id)])
        setSaveStatus('saved')
        if (!silent) notify.success(t('notebook.saved'))
      } catch (e) {
        setSaveStatus('dirty')
        notify.error((e as Error).message)
      }
    },
    [t],
  )

  const updateContent = (content: string) => {
    setNote((prev) => {
      if (!prev) return prev
      const next = { ...prev, content }
      noteRef.current = next
      return next
    })
    setSaveStatus('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const n = noteRef.current
      if (n) void persist(n)
    }, 500)
  }

  const reveal = async () => {
    if (!note) return
    try {
      await api.revealNotebookPath(note.id)
      notify.info(t('notebook.revealedInFinder'))
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const renamePath = useCallback(
    async (rel: string, newName: string) => {
      const m = await api.renameNotebookPath(rel, newName)
      await refresh()
      if (noteRef.current?.id === m.from) await openNote(m.to)
      else if (noteRef.current?.id.startsWith(m.from + '/')) {
        await openNote(noteRef.current.id.replace(m.from, m.to))
      }
    },
    [refresh, openNote],
  )

  const movePath = useCallback(
    async (fromRel: string, destDirRel: string) => {
      const m = await api.moveNotebookPath(fromRel, destDirRel)
      await refresh()
      if (noteRef.current?.id === m.from) await openNote(m.to)
    },
    [refresh, openNote],
  )

  const copyPath = useCallback(
    async (fromRel: string, destDirRel: string) => {
      await api.copyNotebookPath(fromRel, destDirRel)
      await refresh()
    },
    [refresh],
  )

  const createDirInline = useCallback(
    async (parentRel: string, name: string) => {
      const id = await api.createNotebookDir(parentRel, name)
      await refresh()
      setSelectedFolderId(id)
    },
    [refresh],
  )

  const createFileInline = useCallback(
    async (parentRel: string, name: string) => {
      const saved = (await api.createNotebookFile(parentRel, name)) as Note
      await refresh()
      await openNote(saved.id)
    },
    [refresh, openNote],
  )

  const deletePath = useCallback(
    async (rel: string, title: string, kind: 'note' | 'group' = 'note') => {
      const ok = await askConfirm({
        title: kind === 'group' ? t('notebook.deleteGroupTitle') : t('notebook.deleteNoteTitle'),
        message:
          kind === 'group'
            ? t('notebook.deleteGroupMsg', { title })
            : t('notebook.deleteNoteMsg', { title }),
        confirmLabel: t('common.delete'),
        danger: true,
      })
      if (!ok) return
      try {
        await api.deleteNotebookPath(rel)
        if (noteRef.current?.id === rel || noteRef.current?.id.startsWith(rel + '/')) {
          setNote(null)
        }
        await refresh()
        notify.success(t('notebook.deleted'))
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [refresh, t],
  )

  const batchDelete = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        await api.deleteNotebookPath(id)
      }
      if (noteRef.current && ids.some((id) => noteRef.current!.id === id || noteRef.current!.id.startsWith(id + '/'))) {
        setNote(null)
      }
      await refresh()
    },
    [refresh],
  )

  const makeNoteRole = useCallback(
    async (noteId: string, role: NoteRole) => {
      try {
        let cur = noteRef.current?.id === noteId ? noteRef.current : null
        if (!cur) {
          const raw = await api.getNote(noteId)
          if (!raw) throw new Error('note not found')
          cur = adoptNoteLanguage(raw as Note)
        }
        const fields = applyNoteRoleFields(cur, role)
        const next: Note = { ...cur, ...fields }
        const saved = adoptNoteLanguage((await api.saveNote(toNoteDO(next))) as Note)
        if (noteRef.current?.id === noteId) {
          setNote(saved)
          setSaveStatus('saved')
        }
        setSummaries((prev) => prev.map((s) => (s.id === noteId ? toSummary(saved) : s)))
        notify.success(
          role === 'memory'
            ? t('notebook.madeMemory')
            : role === 'skill'
              ? t('notebook.publishSkillOk', { id: saved.id })
              : t('notebook.madeNote'),
        )
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [t],
  )

  const revealPath = useCallback(async (rel: string) => {
    try {
      await api.revealNotebookPath(rel)
      notify.info(t('notebook.revealedInFinder'))
    } catch (e) {
      notify.error((e as Error).message)
    }
  }, [t])

  const mdLike = Boolean(note && isMarkdownLikeLanguage(note.language))
  const showEditor = Boolean(note) && (!mdLike || mdViewMode !== 'preview')
  const showPreview = Boolean(note) && mdLike && mdViewMode !== 'source'
  const splitClass =
    showEditor && showPreview ? ' with-preview' : !showEditor && showPreview ? ' preview-only' : ''

  const editorPane = note ? (
    <>
      <div className={`notebook-editor-split${splitClass}`}>
        {showEditor ? (
          <div className="note-editor-wrap">
            <NoteEditor
              noteId={note.id}
              language={note.language}
              content={note.content}
              onChange={updateContent}
            />
          </div>
        ) : null}
        {showPreview ? (
          <div
            className="notebook-preview-pane"
            title={mdViewMode === 'preview' ? t('notebook.previewEditHint') : undefined}
            onDoubleClick={mdViewMode === 'preview' ? () => setMdViewMode('source') : undefined}
          >
            <div className="notebook-md-preview">
              <MarkdownPreview content={note.content} noteId={note.id} />
            </div>
          </div>
        ) : null}
      </div>
      <NotebookStatusBar
        note={note}
        saveStatus={saveStatus}
        onPickLanguage={() => undefined}
        onRevealInFinder={() => void reveal()}
      />
    </>
  ) : (
    <div className="notebook-ide-empty">{emptyHint || t('notebook.idePickFile')}</div>
  )

  if (!scopeRootId && !hideTree) {
    return (
      <section className={`notebook-ide ${className}`.trim()}>
        <div className="notebook-ide-empty">{emptyHint || t('notebook.noNotes')}</div>
      </section>
    )
  }

  return (
    <section className={`notebook-ide ${className}`.trim()}>
      <header className="notebook-ide-toolbar">
        <h3 className="notebook-ide-title">
          {t('notebook.ideTitle')}
          {scopeLabel ? ` · ${scopeLabel}` : ''}
        </h3>
        <div className="notebook-ide-actions">
          {note && mdLike ? (
            <NotebookMdViewToggle mode={mdViewMode} onChange={setMdViewMode} />
          ) : null}
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-ghost"
            disabled={busy || refreshing}
            {...pressProps(() => void refresh())}
          >
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {hideTree ? (
        <div className="notebook-ide-body is-editor-only">
          <div className="notebook-ide-main">{editorPane}</div>
        </div>
      ) : !scopeExists ? (
        <div className="notebook-ide-empty">{emptyHint || t('notebook.noNotes')}</div>
      ) : (
        <div className="notebook-ide-body">
          <aside className="notebook-ide-tree" style={{ width: treeWidth }}>
            <NotebookSidebar
              compact
              scopeRootId={scopeRootId}
              groups={groups}
              summaries={summaries}
              search={search}
              activeTabId={note?.id ?? null}
              selectedFolderId={selectedFolderId || scopeRootId}
              roleFilter={roleFilter}
              onRoleFilterChange={setRoleFilter}
              onSelectFolder={setSelectedFolderId}
              onSearchChange={setSearch}
              onOpenNote={(id) => void openNote(id)}
              onDeleteGroup={(id, title) => void deletePath(id, title, 'group')}
              onDeleteNote={(id, title) => void deletePath(id, title, 'note')}
              onMakeNoteRole={(id, role) => void makeNoteRole(id, role)}
              onBatchDelete={batchDelete}
              onRefresh={() => void refresh()}
              onRevealPath={(rel) => void revealPath(rel)}
              onRenamePath={renamePath}
              onMovePath={movePath}
              onCopyPath={copyPath}
              onCreateDirInline={createDirInline}
              onCreateFileInline={createFileInline}
              refreshing={refreshing}
            />
          </aside>
          <div className="notebook-ide-main">{editorPane}</div>
        </div>
      )}
    </section>
  )
})

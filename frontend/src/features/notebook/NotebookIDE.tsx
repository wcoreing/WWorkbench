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
import type { Note, NoteSummary, NotebookGroup } from '../../api/types'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { pressProps } from '../../components/compat'
import { NoteEditor } from './NoteEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { NotebookMdViewToggle, type NotebookMdViewMode } from './NotebookMdViewToggle'
import { NotebookScopedTree } from './NotebookScopedTree'
import { NotebookStatusBar } from './NotebookStatusBar'
import { isMarkdownLikeLanguage } from './noteFileTypes'
import { adoptNoteLanguage, skillEntryNoteId, toNoteDO, toSummary } from './noteModel'
import { findNotebookSubtree, buildNotebookTree } from './notebookTree'

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
}

/**
 * NotebookIDE 通用文件树 + 编辑器（笔记本 IDE 模式）。
 * 自管列表/打开/保存；宿主只需传 scopeRootId（日志里=当前任务 Skill）。
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
  },
  ref,
) {
  const { t } = useI18n()
  const [groups, setGroups] = useState<NotebookGroup[]>([])
  const [summaries, setSummaries] = useState<NoteSummary[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [mdViewMode, setMdViewMode] = useState<NotebookMdViewMode>('split')
  const [busy, setBusy] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  noteRef.current = note

  const scopeLabel = useMemo(() => {
    if (title) return title
    if (!scopeRootId) return ''
    return scopeRootId.split('/').filter(Boolean).pop() || scopeRootId
  }, [title, scopeRootId])

  const refresh = useCallback(async () => {
    const [g, n] = await Promise.all([api.listNotebookGroups(), api.listNotes()])
    setGroups(g as NotebookGroup[])
    setSummaries(n as NoteSummary[])
  }, [])

  const openNote = useCallback(
    async (id: string) => {
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
    },
    [],
  )

  useImperativeHandle(ref, () => ({ refresh, openNote }), [refresh, openNote])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

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

  const mdLike = Boolean(note && isMarkdownLikeLanguage(note.language))
  const showEditor = Boolean(note) && (!mdLike || mdViewMode !== 'preview')
  const showPreview = Boolean(note) && mdLike && mdViewMode !== 'source'
  const splitClass =
    showEditor && showPreview ? ' with-preview' : !showEditor && showPreview ? ' preview-only' : ''

  if (!scopeRootId) {
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
            disabled={busy}
            {...pressProps(() => void refresh())}
          >
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {!scopeExists ? (
        <div className="notebook-ide-empty">{emptyHint || t('notebook.noNotes')}</div>
      ) : (
        <div className="notebook-ide-body">
          <aside className="notebook-ide-tree" style={{ width: treeWidth }}>
            <NotebookScopedTree
              rootId={scopeRootId}
              groups={groups}
              summaries={summaries}
              activeNoteId={note?.id}
              emptyHint={emptyHint}
              onOpenNote={(id) => void openNote(id)}
            />
          </aside>
          <div className="notebook-ide-main">
            {note ? (
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
                    <div className="notebook-preview-pane">
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
              <div className="notebook-ide-empty">{t('notebook.idePickFile')}</div>
            )}
          </div>
        </div>
      )}
    </section>
  )
})

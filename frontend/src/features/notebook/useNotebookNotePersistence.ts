import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { api } from '../../api/client'
import type { Note, NoteSummary } from '../../api/types'
import { notify } from '../../notify'
import { nextNoteSortOrder } from './notebookTree'
import { adoptNoteLanguage, noteContentSnapshot, toNoteDO, toSummary } from './noteModel'

type TFn = (key: string, params?: Record<string, string | number>) => string
type SaveStatus = 'saved' | 'dirty' | 'saving'

/** 打开 / 自动保存 / 脏标记：笔记本工作区共用持久化域。 */
export function useNotebookNotePersistence(opts: {
  openNotes: Record<string, Note>
  saveByNote: Record<string, SaveStatus>
  activeTabId: string | null
  activeNote: Note | null
  activeSaveStatus: SaveStatus
  summaries: NoteSummary[]
  setOpenNotes: Dispatch<SetStateAction<Record<string, Note>>>
  setSummaries: Dispatch<SetStateAction<NoteSummary[]>>
  setOpenTabIds: Dispatch<SetStateAction<string[]>>
  setActiveTabId: Dispatch<SetStateAction<string | null>>
  setSaveByNote: Dispatch<SetStateAction<Record<string, SaveStatus>>>
  t: TFn
}) {
  const {
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
  } = opts

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const noteSnapshots = useRef<Record<string, string>>({})
  const openNotesRef = useRef(openNotes)
  openNotesRef.current = openNotes
  const saveByNoteRef = useRef(saveByNote)
  saveByNoteRef.current = saveByNote

  const markNoteSaved = useCallback(
    (note: Note) => {
      noteSnapshots.current[note.id] = noteContentSnapshot(note)
      setSaveByNote((prev) => ({ ...prev, [note.id]: 'saved' }))
    },
    [setSaveByNote],
  )

  const markNoteDirty = useCallback(
    (id: string) => {
      setSaveByNote((prev) => (prev[id] === 'dirty' ? prev : { ...prev, [id]: 'dirty' }))
    },
    [setSaveByNote],
  )

  const persistNote = useCallback(
    async (note: Note, persistOpts?: { silent?: boolean }) => {
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
          setOpenNotes((prev) => ({
            ...prev,
            [note.id]: { ...current, updatedAt: saved.updatedAt },
          }))
          setSummaries((prev) => [
            toSummary({
              ...saved,
              title: current.title,
              language: current.language,
              groupId: current.groupId,
            }),
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
          if (!persistOpts?.silent) notify.success(t('notebook.saved'))
        }
        return saved
      } catch (e) {
        setSaveByNote((prev) => ({ ...prev, [note.id]: 'dirty' }))
        notify.error((e as Error).message)
        throw e
      }
    },
    [markNoteSaved, setOpenNotes, setSaveByNote, setSummaries, t],
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
    [markNoteSaved, persistNote, setActiveTabId, setOpenNotes, setOpenTabIds, setSummaries],
  )

  const scheduleSave = useCallback(
    (note: Note) => {
      if (saveTimers.current[note.id]) clearTimeout(saveTimers.current[note.id])
      saveTimers.current[note.id] = setTimeout(() => {
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
    if (snap === noteContentSnapshot(activeNote) && activeSaveStatus !== 'dirty') {
      notify.success(t('notebook.saved'))
      return
    }
    await persistNote(activeNote)
  }, [activeNote, activeSaveStatus, persistNote, t])

  /** 合并当前笔记字段；无实际变化则不 setState，避免 Monaco 回推造成更新环。 */
  const updateActiveNote = useCallback(
    (patch: Partial<Note>) => {
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
    },
    [activeNote, activeTabId, markNoteDirty, scheduleSave, setOpenNotes, summaries],
  )

  const clearNoteLocalState = useCallback((ids: string[]) => {
    for (const id of ids) {
      if (saveTimers.current[id]) {
        clearTimeout(saveTimers.current[id])
        delete saveTimers.current[id]
      }
      delete noteSnapshots.current[id]
    }
  }, [])

  return {
    openNotesRef,
    saveByNoteRef,
    saveTimers,
    noteSnapshots,
    markNoteSaved,
    markNoteDirty,
    persistNote,
    openNoteById,
    scheduleSave,
    flushSaveActive,
    updateActiveNote,
    clearNoteLocalState,
  }
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { api } from '../../api/client'
import type { Note, NoteSummary, NotebookGroup } from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { notify } from '../../notify'
import { useAppStore } from '../../stores/appStore'
import { withLoading } from '../../stores/loadingStore'
import { isUINotebookPathWrite, isUINotebookWrite } from '../../workbench/radarWrite'
import {
  subscribeWorkbenchChanged,
  takePendingWorkbenchChanged,
  type WorkbenchChangedEvent,
} from '../../workbench/workbenchRadar'
import { adoptNoteLanguage, toNoteDO } from './noteModel'
import { closeNotebookIdsAfterDelete } from './useNotebookPathOps'

type SaveStatus = 'saved' | 'dirty' | 'saving'
type TFn = (key: string, params?: Record<string, string | number>) => string

/** 笔记本启动：boot UI、雷达同步、focus 消费、搜索防抖与标签持久化。 */
export function useNotebookWorkbenchSession(opts: {
  bootLoadingActive: boolean
  search: string
  openTabIds: string[]
  activeTabId: string | null
  openNotesRef: MutableRefObject<Record<string, Note>>
  saveByNoteRef: MutableRefObject<Record<string, SaveStatus>>
  refreshAll: () => Promise<unknown>
  refreshSummaries: () => Promise<unknown>
  openNoteById: (id: string) => Promise<void>
  markNoteSaved: (note: Note) => void
  applyPathMutation: (from: string, to: string) => Promise<void>
  setOpenTabIds: Dispatch<SetStateAction<string[]>>
  setActiveTabId: Dispatch<SetStateAction<string | null>>
  setOpenNotes: Dispatch<SetStateAction<Record<string, Note>>>
  setSaveByNote: Dispatch<SetStateAction<Record<string, SaveStatus>>>
  setSummaries: Dispatch<SetStateAction<NoteSummary[]>>
  setGroups: Dispatch<SetStateAction<NotebookGroup[]>>
  setSelectedFolderId: Dispatch<SetStateAction<string>>
  notebookFocusNoteId: string | null
  setNotebookFocusNoteId: (id: string | null) => void
  notebookFocusFolderId: string | null
  setNotebookFocusFolderId: (id: string | null) => void
  t: TFn
}): { bootReady: boolean } {
  const {
    bootLoadingActive,
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
  } = opts

  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const booted = useRef(false)
  const [bootReady, setBootReady] = useState(false)

  const persistUI = useCallback((tabIds: string[], activeId: string | null) => {
    if (uiTimer.current) clearTimeout(uiTimer.current)
    uiTimer.current = setTimeout(() => {
      void api
        .saveNotebookUI(
          model.NotebookUIDO.createFrom({ openTabIds: tabIds, activeTabId: activeId ?? '' }),
        )
        .catch(() => {})
    }, 300)
  }, [])

  useEffect(() => {
    const closeIds = (deletedIds: string[]) => {
      closeNotebookIdsAfterDelete(
        deletedIds,
        setOpenTabIds,
        setActiveTabId,
        setOpenNotes,
        setSaveByNote,
      )
    }

    const apply = async (evt: WorkbenchChangedEvent) => {
      if (evt.domain === 'notebook.path') {
        if (isUINotebookPathWrite(evt.writeId)) return
        if (evt.op === 'update' && evt.ids.length >= 2) {
          await applyPathMutation(evt.ids[0], evt.ids[1])
          return
        }
        if (evt.op === 'delete') {
          closeIds(evt.ids.filter(Boolean))
          await refreshAll()
          return
        }
        await refreshAll()
        return
      }
      if (evt.domain !== 'notebook.note' && evt.domain !== 'notebook.group') return
      if (evt.domain === 'notebook.group') {
        await refreshAll()
        if (evt.label) {
          notify.info(evt.op === 'delete' ? `分组已删除：${evt.label}` : `分组已更新：${evt.label}`)
        }
        return
      }
      await refreshSummaries()
      const noteId = evt.ids[0]
      if (evt.reveal && noteId && evt.op !== 'delete') {
        await openNoteById(noteId)
        notify.info(evt.label ? `已落笔记本资产：${evt.label}` : `已打开笔记 ${noteId}`)
      } else if (evt.op === 'delete') {
        closeIds(evt.ids.filter(Boolean))
      } else if (noteId && openNotesRef.current[noteId] && evt.op !== 'delete') {
        if (isUINotebookWrite(evt.writeId)) return
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
  }, [
    refreshSummaries,
    refreshAll,
    openNoteById,
    markNoteSaved,
    applyPathMutation,
    openNotesRef,
    saveByNoteRef,
    setOpenTabIds,
    setActiveTabId,
    setOpenNotes,
    setSaveByNote,
  ])

  useEffect(() => {
    if (!bootReady || !notebookFocusNoteId || bootLoadingActive) return
    const id = notebookFocusNoteId
    void openNoteById(id)
      .then(() => refreshSummaries())
      .finally(() => {
        if (useAppStore.getState().notebookFocusNoteId === id) {
          setNotebookFocusNoteId(null)
        }
      })
  }, [
    bootReady,
    notebookFocusNoteId,
    bootLoadingActive,
    openNoteById,
    setNotebookFocusNoteId,
    refreshSummaries,
  ])

  useEffect(() => {
    if (!bootReady || !notebookFocusFolderId || bootLoadingActive) return
    const folderId = notebookFocusFolderId
    setSelectedFolderId(folderId)
    void refreshSummaries().finally(() => {
      if (useAppStore.getState().notebookFocusFolderId === folderId) {
        setNotebookFocusFolderId(null)
      }
    })
  }, [
    bootReady,
    notebookFocusFolderId,
    bootLoadingActive,
    refreshSummaries,
    setNotebookFocusFolderId,
    setSelectedFolderId,
  ])

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
      .catch((e) => notify.error((e as Error).message))
      .finally(() => setBootReady(true))
  }, [
    refreshAll,
    markNoteSaved,
    setNotebookFocusNoteId,
    setOpenNotes,
    setOpenTabIds,
    setActiveTabId,
    setSummaries,
    setGroups,
    t,
  ])

  useEffect(() => {
    if (bootLoadingActive) return
    const timer = setTimeout(() => {
      void refreshSummaries().catch((e) => notify.error((e as Error).message))
    }, 300)
    return () => clearTimeout(timer)
  }, [search, bootLoadingActive, refreshSummaries])

  useEffect(() => {
    if (bootLoadingActive) return
    persistUI(openTabIds, activeTabId)
  }, [openTabIds, activeTabId, bootLoadingActive, persistUI])

  return { bootReady }
}

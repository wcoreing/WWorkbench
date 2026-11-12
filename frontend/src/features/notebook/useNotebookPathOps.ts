import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { api } from '../../api/client'
import type { Note, NoteSummary } from '../../api/types'
import { notify } from '../../notify'
import { remapRel } from './notebookPathOps'

type TFn = (key: string, params?: Record<string, string | number>) => string
type SaveStatus = 'saved' | 'dirty' | 'saving'

export type NotebookDeleteTarget = { kind: 'note' | 'group'; id: string; title: string }

/** 笔记本路径改名/移动/复制/建文件与删除后的本地状态 remap。 */
export function useNotebookPathOps(opts: {
  refreshAll: () => Promise<unknown>
  openNoteById: (id: string) => Promise<void>
  setOpenTabIds: Dispatch<SetStateAction<string[]>>
  setActiveTabId: Dispatch<SetStateAction<string | null>>
  setSelectedFolderId: Dispatch<SetStateAction<string>>
  setOpenNotes: Dispatch<SetStateAction<Record<string, Note>>>
  setSaveByNote: Dispatch<SetStateAction<Record<string, SaveStatus>>>
  setSummaries: Dispatch<SetStateAction<NoteSummary[]>>
  activeTabId: string | null
  selectedFolderId: string
  t: TFn
}) {
  const {
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
  } = opts

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
        const next: Record<string, SaveStatus> = {}
        for (const [id, st] of Object.entries(prev)) next[mapId(id)] = st
        return next
      })
      await refreshAll()
    },
    [refreshAll, setActiveTabId, setOpenNotes, setOpenTabIds, setSaveByNote, setSelectedFolderId],
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
    [refreshAll, setSelectedFolderId],
  )

  const createFileInline = useCallback(
    async (parentRel: string, name: string) => {
      const saved = (await api.createNotebookFile(parentRel, name)) as Note
      await refreshAll()
      await openNoteById(saved.id)
    },
    [refreshAll, openNoteById],
  )

  /** confirmDelete 删除笔记或目录后清本地标签/树状态。 */
  const confirmDelete = useCallback(
    async (
      deleteTarget: NotebookDeleteTarget,
      onDone: () => void,
    ) => {
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
          const prefix = deleteTarget.id + '/'
          setOpenTabIds((prev) =>
            prev.filter((id) => id !== deleteTarget.id && !id.startsWith(prefix)),
          )
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
        notify.success(t('notebook.deleted'))
      } catch (e) {
        notify.error((e as Error).message)
      } finally {
        onDone()
      }
    },
    [
      activeTabId,
      refreshAll,
      selectedFolderId,
      setActiveTabId,
      setOpenNotes,
      setOpenTabIds,
      setSaveByNote,
      setSelectedFolderId,
      setSummaries,
      t,
    ],
  )

  return {
    applyPathMutation,
    renameNotebookPath,
    moveNotebookPath,
    copyNotebookPath,
    createDirInline,
    createFileInline,
    confirmDelete,
  }
}

/** closeIdsAfterPathDelete 路径雷达删除时关掉受影响标签。 */
export function closeNotebookIdsAfterDelete(
  deletedIds: string[],
  setOpenTabIds: Dispatch<SetStateAction<string[]>>,
  setActiveTabId: Dispatch<SetStateAction<string | null>>,
  setOpenNotes: Dispatch<SetStateAction<Record<string, Note>>>,
  setSaveByNote: Dispatch<SetStateAction<Record<string, SaveStatus>>>,
) {
  if (deletedIds.length === 0) return
  const hit = (id: string) => deletedIds.some((d) => id === d || id.startsWith(d + '/'))
  setOpenTabIds((prev) => {
    const next = prev.filter((id) => !hit(id))
    setActiveTabId((cur) => (cur && hit(cur) ? next[next.length - 1] ?? null : cur))
    return next
  })
  setOpenNotes((prev) => {
    const next = { ...prev }
    for (const id of Object.keys(next)) {
      if (hit(id)) delete next[id]
    }
    return next
  })
  setSaveByNote((prev) => {
    const next = { ...prev }
    for (const id of Object.keys(next)) {
      if (hit(id)) delete next[id]
    }
    return next
  })
}

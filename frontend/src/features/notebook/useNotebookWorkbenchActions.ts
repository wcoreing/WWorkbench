import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { api } from '../../api/client'
import type {
  Connection,
  Note,
  NoteLanguage,
  NoteRole,
  NoteSummary,
  NotebookGroup,
  ShellHost,
} from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { notify } from '../../notify'
import { openDatabase as openDatabaseWorkbench, openTerminal } from '../../stores/productLink'
import { fileToBase64DataURL } from './notebookAssets'
import type { NoteEditorHandle } from './NoteEditor'
import type { NewFileDraft } from './NotebookNewFileModal'
import { applyNoteRoleFields } from './noteFrontmatter'
import { isMarkdownLikeLanguage } from './noteFileTypes'
import { toSummary } from './noteModel'
import {
  buildConnectionTemplate,
  buildServerChecklistTemplate,
  buildShellHostTemplate,
  extractRunCommands,
  extractSqlText,
} from './noteTemplates'
import { buildNotebookLayout, nextNoteSortOrder } from './notebookTree'

type SaveStatus = 'saved' | 'dirty' | 'saving'
type TFn = (key: string, params?: Record<string, string | number>) => string

/** 笔记本工作区动作：建文件/分组、附件、标签、终端/库跳转、布局与批量删除。 */
export function useNotebookWorkbenchActions(opts: {
  activeNote: Note | null
  activeTabId: string | null
  summaries: NoteSummary[]
  groups: NotebookGroup[]
  hosts: ShellHost[]
  connections: Connection[]
  editorRef: RefObject<NoteEditorHandle | null>
  opsRoot: string
  refreshAll: () => Promise<unknown>
  openNoteById: (id: string) => Promise<void>
  markNoteSaved: (note: Note) => void
  markNoteDirty: (id: string) => void
  updateActiveNote: (patch: Partial<Note>) => void
  clearNoteLocalState: (ids: string[]) => void
  setOpenTabIds: Dispatch<SetStateAction<string[]>>
  setActiveTabId: Dispatch<SetStateAction<string | null>>
  setOpenNotes: Dispatch<SetStateAction<Record<string, Note>>>
  setSaveByNote: Dispatch<SetStateAction<Record<string, SaveStatus>>>
  setSummaries: Dispatch<SetStateAction<NoteSummary[]>>
  setGroups: Dispatch<SetStateAction<NotebookGroup[]>>
  setNewFileGroupId: Dispatch<SetStateAction<string | null>>
  setStatusMessage: (msg: string) => void
  t: TFn
}) {
  const {
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
  } = opts

  const openCreateFile = (groupId = opsRoot) => {
    setNewFileGroupId(groupId)
  }

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
    notify.success(t('notebook.created'))
  }

  const duplicateNote = async () => {
    if (!activeNote) return
    try {
      const saved = (await api.duplicateNote(activeNote.id)) as Note
      setSummaries((prev) => [toSummary(saved), ...prev])
      await openNoteById(saved.id)
      notify.success(t('notebook.duplicated'))
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const exportNote = async () => {
    if (!activeNote) return
    try {
      const path = await api.exportNote(activeNote.id)
      if (path) notify.success(t('notebook.exported', { path }), { detail: path })
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const revealNoteInFinder = async (noteId?: string) => {
    try {
      await api.revealNotebookNote(noteId || '')
      notify.info(t('notebook.revealedInFinder'))
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

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
    const conn = activeNote.connectionId
      ? connections.find((c) => c.id === activeNote.connectionId)
      : undefined
    let block = ''
    if (conn) block = buildConnectionTemplate(conn)
    else if (host) block = buildShellHostTemplate(host)
    else block = buildServerChecklistTemplate(activeNote.title)
    const content = activeNote.content.trim() ? `${activeNote.content}\n\n${block}` : block
    updateActiveNote({ content, language: 'markdown' })
    notify.success(t('notebook.templateInserted'))
  }

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
            return { ...prev, [activeNote.id]: { ...cur, language: 'markdown' as NoteLanguage } }
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
    [activeNote, editorRef, setOpenNotes, markNoteDirty],
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
        notify.success(
          snippets.length === 1
            ? t('notebook.assetInserted')
            : t('notebook.assetsInserted', { count: snippets.length }),
        )
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [activeNote, appendAssetMarkdown, t],
  )

  const pickAssets = useCallback(
    async (imagesOnly: boolean) => {
      if (!activeNote) return
      try {
        const assets = await api.pickNotebookAssets(activeNote.id, imagesOnly)
        if (!assets.length) return
        appendAssetMarkdown(assets.map((a) => a.markdown))
        notify.success(
          assets.length === 1
            ? t('notebook.assetInserted')
            : t('notebook.assetsInserted', { count: assets.length }),
        )
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [activeNote, appendAssetMarkdown, t],
  )

  const closeTab = (id: string) => {
    setOpenTabIds((prev) => {
      const next = prev.filter((tabId) => tabId !== id)
      if (activeTabId === id) setActiveTabId(next[next.length - 1] ?? null)
      return next
    })
  }

  const closeOtherTabs = (keepId: string) => {
    setOpenTabIds([keepId])
    setActiveTabId(keepId)
  }

  const closeAllTabs = () => {
    setOpenTabIds([])
    setActiveTabId(null)
  }

  const runInTerminal = () => {
    if (!activeNote) return
    const text = editorRef.current?.getSelectedText() ?? activeNote.content
    const command = extractRunCommands(text)
    if (!command) {
      notify.warning(t('notebook.noCommands'))
      return
    }
    if (activeNote.sshHostId) {
      openTerminal({ hostId: activeNote.sshHostId, initialCommand: command }, 'notebook')
    } else {
      openTerminal({ localShell: true, initialCommand: command }, 'notebook')
    }
    setStatusMessage(t('notebook.runningCmd'))
  }

  const openDatabase = (runSql = true) => {
    if (!activeNote?.connectionId) return
    const conn = connections.find((c) => c.id === activeNote.connectionId)
    const text = editorRef.current?.getSelectedText() ?? activeNote.content
    const sql = extractSqlText(text)
    if (!sql) {
      setStatusMessage(conn ? t('notebook.openingConn', { name: conn.name }) : t('notebook.openingDb'))
    } else if (runSql) {
      setStatusMessage(
        conn ? t('notebook.openingConnSql', { name: conn.name }) : t('notebook.openingDbSql'),
      )
    } else {
      setStatusMessage(
        conn ? t('notebook.openingConnFill', { name: conn.name }) : t('notebook.openingDbFill'),
      )
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

  const onConnectionLinkChange = (connectionId: string) => {
    const conn = connectionId ? connections.find((c) => c.id === connectionId) : undefined
    const patch: Partial<Note> = { connectionId }
    if (conn?.sshHostId) patch.sshHostId = conn.sshHostId
    updateActiveNote(patch)
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
          layout.groupOrder
            .map((id, i) => {
              const g = prev.find((x) => x.id === id)
              return g ? { ...g, sortOrder: i } : null
            })
            .filter((g): g is NotebookGroup => Boolean(g)),
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
        notify.success(t('notebook.layoutSaved'))
      } catch (e) {
        await refreshAll()
        notify.error((e as Error).message)
        throw e
      }
    },
    [refreshAll, setGroups, setSummaries, setOpenNotes, t],
  )

  const handleBatchDeleteNotes = async (ids: string[]) => {
    const known = new Set(summaries.map((s) => s.id))
    const toDelete = [...new Set(ids.filter((id) => known.has(id)))]
    if (toDelete.length === 0) {
      throw new Error(t('notebook.batchNone'))
    }
    const idSet = new Set(toDelete)

    clearNoteLocalState(toDelete)

    const nextSummaries = summaries.filter((s) => !idSet.has(s.id))
    await api.deleteNotes(toDelete)
    try {
      await persistNotebookLayout(buildNotebookLayout(groups, nextSummaries))
    } catch {
      setSummaries(nextSummaries)
    }

    setOpenTabIds((prev) => {
      const next = prev.filter((id) => !idSet.has(id))
      setActiveTabId((current) =>
        current && idSet.has(current) ? next[next.length - 1] ?? null : current,
      )
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

  return {
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
  }
}

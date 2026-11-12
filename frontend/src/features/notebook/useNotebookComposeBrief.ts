import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { api } from '../../api/client'
import type { Note, NoteSummary } from '../../api/types'
import { openAgentDraft } from '../agent/openAgentDraft'
import { notify } from '../../notify'
import { NOTEBOOK_ROOT_OPS } from './businessRoots'
import {
  BRIEF_DIR_REL,
  BRIEF_FOLDER_NAME,
  buildBriefAgentPrompt,
  buildBriefScaffold,
  safeBriefFileName,
} from './composeBrief'
import type { ComposeBriefDraft } from './ComposeBriefModal'
import { basenameRel, uniqueSiblingName } from './notebookPathOps'
import { adoptNoteLanguage, toNoteDO, toSummary } from './noteModel'

type TFn = (key: string, params?: Record<string, string | number>) => string
type MdViewMode = 'source' | 'preview' | 'split'

/** 整理页：选料 → 落盘骨架 → 预览 → Agent 收口。 */
export function useNotebookComposeBrief(opts: {
  groups: { id: string }[]
  summaries: NoteSummary[]
  refreshAll: () => Promise<unknown>
  openNoteById: (id: string) => Promise<void>
  markNoteSaved: (note: Note) => void
  setSummaries: Dispatch<SetStateAction<NoteSummary[]>>
  setSelectedFolderId: (id: string) => void
  setMdViewMode: (mode: MdViewMode) => void
  t: TFn
}) {
  const {
    groups,
    summaries,
    refreshAll,
    openNoteById,
    markNoteSaved,
    setSummaries,
    setSelectedFolderId,
    setMdViewMode,
    t,
  } = opts

  const [briefSourceIds, setBriefSourceIds] = useState<string[] | null>(null)

  const ensureBriefDir = useCallback(async () => {
    if (groups.some((g) => g.id === BRIEF_DIR_REL)) return BRIEF_DIR_REL
    try {
      const id = await api.createNotebookDir(NOTEBOOK_ROOT_OPS, BRIEF_FOLDER_NAME)
      await refreshAll()
      return id
    } catch {
      return BRIEF_DIR_REL
    }
  }, [groups, refreshAll])

  const submitComposeBrief = useCallback(
    async (draft: ComposeBriefDraft) => {
      const sourceIds = briefSourceIds || []
      if (sourceIds.length === 0) throw new Error(t('notebook.briefNeedSources'))
      const dir = await ensureBriefDir()
      const preferred = `${safeBriefFileName(draft.title)}.md`
      const existing = summaries
        .filter((s) => s.groupId === dir || s.id.startsWith(dir + '/'))
        .map((s) => basenameRel(s.id))
      const fileName = uniqueSiblingName(existing, preferred)
      const created = (await api.createNotebookFile(dir, fileName)) as Note
      const content = buildBriefScaffold({
        title: draft.title,
        templateId: draft.templateId,
        requirement: draft.requirement,
        sourceNoteIds: sourceIds,
      })
      const saved = adoptNoteLanguage(
        (await api.saveNote(
          toNoteDO({
            ...created,
            title: draft.title,
            content,
            language: 'markdown',
            role: 'note',
          }),
        )) as Note,
      )
      setSummaries((prev) => {
        const rest = prev.filter((s) => s.id !== saved.id)
        return [...rest, toSummary(saved)]
      })
      markNoteSaved(saved)
      setSelectedFolderId(dir)
      setMdViewMode('preview')
      await openNoteById(saved.id)
      openAgentDraft({
        mentions: [],
        message: buildBriefAgentPrompt({
          briefNoteId: saved.id,
          title: draft.title,
          requirement: draft.requirement,
          sourceNoteIds: sourceIds,
        }),
        autoSend: true,
        mode: 'agent',
      })
      notify.success(t('notebook.briefCreated', { title: draft.title }))
    },
    [
      briefSourceIds,
      ensureBriefDir,
      markNoteSaved,
      openNoteById,
      setMdViewMode,
      setSelectedFolderId,
      setSummaries,
      summaries,
      t,
    ],
  )

  const briefDefaultTitle = (() => {
    const id = briefSourceIds?.[0]
    if (!id) return ''
    const hit = summaries.find((s) => s.id === id)
    const label = (hit?.title || '').trim() || basenameRel(id).replace(/\.md$/i, '')
    return label ? `${label}·整理` : ''
  })()

  return {
    briefSourceIds,
    setBriefSourceIds,
    submitComposeBrief,
    briefDefaultTitle,
  }
}

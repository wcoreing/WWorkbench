import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { api } from '../../api/client'
import type { Note, NoteRole, NoteSummary } from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import { applyNoteRoleFields } from './noteFrontmatter'
import { adoptNoteLanguage, toNoteDO, toSummary } from './noteModel'
import { readLinkedSkillId, suggestSkillId } from './noteSkillLink'
import { notify } from '../../notify'

type TFn = (key: string, params?: Record<string, string | number>) => string

type SetNotes = Dispatch<SetStateAction<Record<string, Note>>>
type SetSummaries = Dispatch<SetStateAction<NoteSummary[]>>
type SetSaveByNote = Dispatch<SetStateAction<Record<string, 'saved' | 'dirty' | 'saving'>>>

/** 就地标 Skill / 改角色：与后端 MarkNoteAsSkill 协议对齐，不迁任务区。 */
export function useNotebookNoteRole(opts: {
  activeNote: Note | null
  openNotes: Record<string, Note>
  setOpenNotes: SetNotes
  setSummaries: SetSummaries
  setSaveByNote: SetSaveByNote
  refreshAll: () => Promise<unknown>
  t: TFn
}) {
  const { activeNote, openNotes, setOpenNotes, setSummaries, setSaveByNote, refreshAll, t } = opts

  const publishSkill = useCallback(
    async (noteOverride?: Note) => {
      const target = noteOverride || activeNote
      if (!target) return
      const linked = readLinkedSkillId(target.content)
      const id = linked || suggestSkillId(target.title, target.id)
      try {
        const sk = await api.publishNoteAsSkill(
          model.AgentSkillPublishDO.createFrom({
            id,
            name: target.title || id,
            description: '',
            content: '',
            noteId: target.id,
          }),
        )
        notify.success(t('notebook.publishSkillOk', { id: sk.id }), { detail: sk.id })
        await refreshAll()
        const refreshed = await api.getNote(target.id)
        if (refreshed) {
          const adopted = adoptNoteLanguage(refreshed as Note)
          setOpenNotes((prev) => {
            // 发布可能迁路径：用新 id 替换旧 tab 映射
            if (adopted.id !== target.id) {
              const next = { ...prev }
              delete next[target.id]
              next[adopted.id] = adopted
              return next
            }
            return { ...prev, [target.id]: adopted }
          })
        }
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [activeNote, refreshAll, setOpenNotes, t],
  )

  const makeNoteRole = useCallback(
    async (noteId: string, role: NoteRole) => {
      try {
        let note = openNotes[noteId]
        if (!note) {
          const raw = await api.getNote(noteId)
          if (!raw) throw new Error('note not found')
          note = adoptNoteLanguage(raw as Note)
        }
        const fields = applyNoteRoleFields(note, role)
        const next: Note = { ...note, ...fields }
        if (role === 'skill') {
          const saved = (await api.saveNote(toNoteDO(next))) as Note
          setOpenNotes((prev) => (prev[noteId] ? { ...prev, [noteId]: adoptNoteLanguage(saved) } : prev))
          setSummaries((prev) => prev.map((s) => (s.id === noteId ? toSummary(saved) : s)))
          await publishSkill(adoptNoteLanguage(saved))
          return
        }
        const saved = (await api.saveNote(toNoteDO(next))) as Note
        const adopted = adoptNoteLanguage(saved)
        setOpenNotes((prev) => (prev[noteId] ? { ...prev, [noteId]: adopted } : prev))
        setSummaries((prev) => prev.map((s) => (s.id === noteId ? toSummary(adopted) : s)))
        setSaveByNote((prev) => ({ ...prev, [noteId]: 'saved' }))
        notify.success(role === 'memory' ? t('notebook.madeMemory') : t('notebook.madeNote'))
      } catch (e) {
        notify.error((e as Error).message)
      }
    },
    [openNotes, publishSkill, setOpenNotes, setSaveByNote, setSummaries, t],
  )

  return { publishSkill, makeNoteRole }
}

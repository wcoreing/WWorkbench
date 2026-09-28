import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'
import { useAppStore } from '../../stores/appStore'
import { openNotebook } from '../../workbench/assetOpen'
import type { AgentMention } from './agentMention'

/** saveReplyToNotebook 将助手回复写入笔记本，并切换打开对应笔记。 */
export async function saveReplyToNotebook(
  content: string,
  mentions: AgentMention[],
  title?: string,
): Promise<'savedToNotebook' | 'appendedToNotebook'> {
  const text = content.trim()
  if (!text) throw new Error('没有可保存的内容')

  const ssh = mentions.find((m) => m.kind === 'ssh')
  const db = mentions.find((m) => m.kind === 'database')
  const { activeProduct, notebookActiveNoteId } = useAppStore.getState()
  const append = activeProduct === 'notebook' && Boolean(notebookActiveNoteId)

  let noteId: string
  if (append && notebookActiveNoteId) {
    const note = await api.getNote(notebookActiveNoteId)
    const merged = note.content.trim() ? `${note.content}\n\n---\n\n${text}` : text
    const saved = await api.saveNote(
      model.NoteDO.createFrom({
        ...note,
        content: merged,
        updatedAt: 0,
      }),
    )
    noteId = saved.id
  } else {
    const noteTitle =
      title?.trim() ||
      `AI 报告 ${new Date().toLocaleString('zh-CN', { hour12: false })}`

    const saved = await api.saveNote(
      model.NoteDO.createFrom({
        id: '',
        groupId: '',
        title: noteTitle,
        content: text,
        language: 'markdown',
        sshHostId: ssh?.id ?? '',
        connectionId: db?.id ?? '',
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    )
    noteId = saved.id
  }

  // 先记下 focus，再经 CommandBus 切产品线；首次挂载时 boot 结束后再打开，避免被持久化草稿覆盖。
  useAppStore.getState().setNotebookFocusNoteId(noteId)
  openNotebook({ noteId }, 'agent')
  return append ? 'appendedToNotebook' : 'savedToNotebook'
}

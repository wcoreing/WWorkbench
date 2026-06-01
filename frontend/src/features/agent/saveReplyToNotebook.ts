import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'
import { useAppStore } from '../../stores/appStore'
import type { AgentMention } from './agentMention'

/** saveReplyToNotebook 将助手回复写入笔记本（优先追加到当前打开的笔记）。 */
export async function saveReplyToNotebook(
  content: string,
  mentions: AgentMention[],
  title?: string,
): Promise<string> {
  const text = content.trim()
  if (!text) throw new Error('没有可保存的内容')

  const ssh = mentions.find((m) => m.kind === 'ssh')
  const db = mentions.find((m) => m.kind === 'database')
  const { activeProduct, notebookActiveNoteId } = useAppStore.getState()

  if (activeProduct === 'notebook' && notebookActiveNoteId) {
    const note = await api.getNote(notebookActiveNoteId)
    const merged = note.content.trim() ? `${note.content}\n\n---\n\n${text}` : text
    const saved = await api.saveNote(
      model.NoteDO.createFrom({
        ...note,
        content: merged,
        updatedAt: 0,
      }),
    )
    useAppStore.getState().setNotebookFocusNoteId(saved.id)
    return saved.id
  }

  const groups = await api.listNotebookGroups()
  const groupId = groups[0]?.id
  if (!groupId) throw new Error('请先创建笔记本分组')

  const noteTitle =
    title?.trim() ||
    `AI 报告 ${new Date().toLocaleString('zh-CN', { hour12: false })}`

  const saved = await api.saveNote(
    model.NoteDO.createFrom({
      id: '',
      groupId,
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

  useAppStore.getState().setActiveProduct('notebook')
  useAppStore.getState().setNotebookFocusNoteId(saved.id)
  return saved.id
}

/** savedToNotebookMessage 根据是否追加返回状态文案 key 后缀。 */
export function savedToNotebookMessage(): 'savedToNotebook' | 'appendedToNotebook' {
  const { activeProduct, notebookActiveNoteId } = useAppStore.getState()
  return activeProduct === 'notebook' && notebookActiveNoteId
    ? 'appendedToNotebook'
    : 'savedToNotebook'
}

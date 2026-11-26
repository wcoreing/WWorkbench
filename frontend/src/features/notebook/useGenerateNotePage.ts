import { useCallback } from 'react'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { useAgentStore } from '../../stores/agentStore'
import { mentionNote, openAgentDraft } from '../agent/openAgentDraft'

/** 笔记工具栏「生成」绑定的技能。按钮是这条技能的快捷方式。 */
export const NOTE_VIEW_SKILL_ID = '运维/账号HTML视图'

function generatePagePrompt(noteId: string) {
  return (
    `请按已绑定技能「${NOTE_VIEW_SKILL_ID}」为这篇笔记生成页面。这是该技能的快捷方式。\n` +
    `笔记：${noteId}\n` +
    `1. get_skill 读技能，get_note 读这篇笔记。\n` +
    `2. 按技能把账号写进这篇笔记自己的 view 工程（index.html、src/main.js、src/App.vue、src/components）。已有工程只改这次要动的文件。初始模板不是完成。\n` +
    `3. package_note_view(noteId=这篇笔记, skill=${NOTE_VIEW_SKILL_ID})。\n` +
    `4. 回复工程路径、页面路径和条数。口令不复述。`
  )
}

/** useGenerateNotePage 把当前笔记交给侧栏 Agent，按技能写 view 并打包。 */
export function useGenerateNotePage(noteId: string) {
  const { t } = useI18n()
  const generate = useCallback(() => {
    const id = noteId.trim()
    if (!id) return
    const phase = useAgentStore.getState().sessionPhase
    if (phase === 'streaming' || phase === 'tools' || phase === 'needs_choice') {
      notify.info(t('notebook.generatePageBusy'))
      return
    }
    openAgentDraft({
      mentions: [mentionNote({ id })],
      skillIds: [NOTE_VIEW_SKILL_ID],
      message: generatePagePrompt(id),
      autoSend: true,
      mode: 'agent',
    })
    notify.info(t('notebook.generatePageHanded'))
  }, [noteId, t])
  return { generating: false, generate }
}

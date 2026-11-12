import { NOTEBOOK_ROOT_OPS } from './businessRoots'

/** 整理页落盘目录（运维工作根下）。 */
export const BRIEF_FOLDER_NAME = '整理页'
export const BRIEF_DIR_REL = `${NOTEBOOK_ROOT_OPS}/${BRIEF_FOLDER_NAME}`

export type BriefTemplateId = 'handover' | 'hostQuick' | 'projectList' | 'custom'

export type BriefTemplate = {
  id: BriefTemplateId
  labelKey: string
  /** 写入 Agent 提示的默认需求句 */
  defaultRequirement: string
}

export const BRIEF_TEMPLATES: BriefTemplate[] = [
  {
    id: 'handover',
    labelKey: 'notebook.briefTplHandover',
    defaultRequirement:
      '整理成运维交接一页纸：环境概览、关键主机/项目、账号口令、注意点与待办。账密与数据源保持一致，禁止脱敏。',
  },
  {
    id: 'hostQuick',
    labelKey: 'notebook.briefTplHostQuick',
    defaultRequirement:
      '整理成主机速查：按主机分组，列出角色、登录账号/密码或密钥位置、关键路径、坑与约定；缺信息处标明「待补」，已有账密原样保留。',
  },
  {
    id: 'projectList',
    labelKey: 'notebook.briefTplProjectList',
    defaultRequirement:
      '整理成项目清单：项目名、关联主机、本地/远端路径、登录信息、可用方法（Skill）；数据源里的账号密码原样写入。',
  },
  {
    id: 'custom',
    labelKey: 'notebook.briefTplCustom',
    defaultRequirement: '',
  },
]

/** safeBriefFileName 生成安全文件名（不含路径与扩展名）。 */
export function safeBriefFileName(title: string): string {
  const raw = (title || '').trim() || '未命名整理页'
  return raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

/** buildBriefScaffold 落盘骨架：标明数据源与需求，正文留给 Agent 重写。 */
export function buildBriefScaffold(opts: {
  title: string
  templateId: BriefTemplateId
  requirement: string
  sourceNoteIds: string[]
}): string {
  const req = opts.requirement.trim() || '请按数据源合理整理成一页可读内容。'
  const sources = opts.sourceNoteIds.map((id) => `- \`${id}\``).join('\n')
  return (
    `---\nrole: note\nbriefTemplate: ${opts.templateId}\n---\n\n` +
    `# ${opts.title.trim() || '整理页'}\n\n` +
    `> **数据源**\n${sources}\n\n` +
    `> **整理需求**：${req}\n\n` +
    `---\n\n` +
    `## 正文\n\n` +
    `_待根据数据源整理。可用侧栏 Agent 按需求重写本页。_\n`
  )
}

/** buildBriefAgentPrompt 打开 Agent 自动收口的提示语。 */
export function buildBriefAgentPrompt(opts: {
  briefNoteId: string
  title: string
  requirement: string
  sourceNoteIds: string[]
}): string {
  const req = opts.requirement.trim() || '按数据源整理成结构清晰、可直接阅读的一页内容'
  const list = opts.sourceNoteIds.map((id) => `- ${id}`).join('\n')
  return (
    `请做「整理页」收口（选料→按需求生成页，不是图谱）：\n` +
    `1. 用 get_note 逐个阅读数据源：\n${list}\n` +
    `2. 按需求整理：${req}\n` +
    `3. 用 notebook_append_content（appendToNoteId=\`${opts.briefNoteId}\`）把整理后的 Markdown 正文追加到整理页「${opts.title}」：` +
    `不要机械粘贴全文；按主题重组；缺信息处写「待补」；可先写「## 整理结果」再写正文。\n` +
    `4. **账密政策（整理页专属）**：这是给人管账号密码的工作页。数据源里的账号、密码、口令、密钥、连接串必须原样写入整理页正文；` +
    `禁止脱敏、打码、省略、改成「*** / 已隐藏 / 待补」。聊天里用一句话交代「已写入整理页」即可，不必在对话里再念一遍密码。\n` +
    `5. 写完用一句话说明相对数据源还缺什么（若有）。`
  )
}

/** briefTemplateById 取模板；未知则 custom。 */
export function briefTemplateById(id: string): BriefTemplate {
  return BRIEF_TEMPLATES.find((t) => t.id === id) || BRIEF_TEMPLATES[BRIEF_TEMPLATES.length - 1]
}

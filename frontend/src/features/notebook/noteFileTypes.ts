/** 笔记文件类型（language 列）；可自定义任意扩展名/标识。 */

export type NoteLanguage = string

export type NoteFileTypePreset = {
  id: NoteLanguage
  /** i18n key under notebook.* */
  labelKey: string
  /** 侧栏/标题展示用短后缀 */
  ext: string
  markdownLike: boolean
}

/** 内置预设（运维优先：shell/配置在前；其余代码类型靠后）。 */
export const NOTE_FILE_TYPE_PRESETS: NoteFileTypePreset[] = [
  { id: 'shell', labelKey: 'langShell', ext: '.sh', markdownLike: false },
  { id: 'markdown', labelKey: 'langMarkdown', ext: '.md', markdownLike: true },
  { id: 'yaml', labelKey: 'langYaml', ext: '.yaml', markdownLike: false },
  { id: 'sql', labelKey: 'langSql', ext: '.sql', markdownLike: false },
  { id: 'json', labelKey: 'langJson', ext: '.json', markdownLike: false },
  { id: 'dockerfile', labelKey: 'langDockerfile', ext: '.dockerfile', markdownLike: false },
  { id: 'python', labelKey: 'langPython', ext: '.py', markdownLike: false },
  { id: 'skill.md', labelKey: 'langSkillMd', ext: '.skill.md', markdownLike: true },
  { id: 'plaintext', labelKey: 'langPlain', ext: '.txt', markdownLike: false },
  { id: 'javascript', labelKey: 'langJavascript', ext: '.js', markdownLike: false },
  { id: 'typescript', labelKey: 'langTypescript', ext: '.ts', markdownLike: false },
  { id: 'html', labelKey: 'langHtml', ext: '.html', markdownLike: false },
  { id: 'css', labelKey: 'langCss', ext: '.css', markdownLike: false },
]

/** isMarkdownLikeLanguage 是否按 Markdown 预览。 */
export function isMarkdownLikeLanguage(language: string): boolean {
  const id = (language || 'markdown').trim().toLowerCase()
  const preset = NOTE_FILE_TYPE_PRESETS.find((p) => p.id === id)
  if (preset) return preset.markdownLike
  return id.endsWith('.md') || id === 'md' || id.includes('markdown')
}

/** extForLanguage 侧栏短后缀。 */
export function extForLanguage(language: string): string {
  const id = (language || '').trim().toLowerCase()
  const preset = NOTE_FILE_TYPE_PRESETS.find((p) => p.id === id)
  if (preset) return preset.ext
  if (!id || id === 'markdown') return '.md'
  if (id.startsWith('.')) return id
  return `.${id}`
}

/** languageForRole 按角色推荐文件类型。 */
export function languageForRole(role: string, current: string): string {
  switch (role) {
    case 'skill':
      return 'skill.md'
    case 'memory':
      return isMarkdownLikeLanguage(current) ? current || 'markdown' : 'markdown'
    default:
      return current || 'markdown'
  }
}

/** ensureWorkflowStepsFence 标为工作流时若无步骤围栏则补空骨架。 */
export function ensureWorkflowStepsFence(content: string): string {
  if (/```wwb-skill-steps/.test(content)) return content
  const block = '\n\n## 步骤\n\n```wwb-skill-steps\n[]\n```\n'
  return content.trim() ? `${content.trimEnd()}${block}` : `# 工作流\n${block}`
}

/** monacoLanguageForNote 笔记 language → Monaco language id（IDE 高亮）。 */
export function monacoLanguageForNote(language: string): string {
  const id = (language || 'markdown').trim().toLowerCase()
  if (id === 'skill.md' || id === 'md' || id.endsWith('.md')) return 'markdown'
  if (id === 'shell' || id === 'sh' || id === 'bash' || id === 'zsh') return 'shell'
  if (id === 'plaintext' || id === 'text' || id === 'txt') return 'plaintext'
  if (id === 'js' || id === 'jsx' || id === 'mjs' || id === 'cjs') return 'javascript'
  if (id === 'ts' || id === 'tsx') return 'typescript'
  if (id === 'py') return 'python'
  if (id === 'yml') return 'yaml'
  if (id === 'htm') return 'html'
  if (id === 'dockerfile') return 'dockerfile'
  if (id === 'makefile') return 'makefile'
  if (id === 'toml') return 'ini'
  if (id.endsWith('.md') || id.includes('markdown')) return 'markdown'
  // 直接把常见 id 交给 Monaco（json/yaml/sql/python/…）
  return id || 'plaintext'
}

/** defaultTitleForLanguage 新建文件默认名（不含扩展名）。 */
export function defaultTitleForLanguage(language: string, unnamed: string): string {
  const id = (language || 'markdown').trim().toLowerCase()
  if (id === 'markdown' || id.endsWith('.md')) return unnamed
  return 'untitled'
}


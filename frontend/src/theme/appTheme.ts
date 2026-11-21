/** 应用外观主题（data-theme）。 */
export type AppTheme =
  | 'light'
  | 'cream'
  | 'gold'
  | 'grass'
  | 'matcha'
  | 'sky'
  | 'peach'
  | 'amber'
  | 'coral'
  | 'honey'
  | 'lilac'
  | 'mint'
  | 'olive'
  | 'pink'
  | 'dark'

export const APP_THEMES: readonly AppTheme[] = [
  'light',
  'cream',
  'gold',
  'grass',
  'matcha',
  'sky',
  'peach',
  'amber',
  'coral',
  'honey',
  'lilac',
  'mint',
  'olive',
  'pink',
  'dark',
] as const

const THEMES = new Set<string>(APP_THEMES)

/** parseAppTheme 将设置值规范为合法主题。 */
export function parseAppTheme(raw: string | null | undefined): AppTheme {
  if (raw === 'ink') return 'olive'
  if (raw === 'khaki' || raw === 'maize') return 'gold'
  // YingDao 临时主题回迁
  if (raw === 'classic') return 'light'
  if (raw === 'cyan' || raw === 'crimson' || raw === 'orange') return 'dark'
  if (raw === 'green') return 'mint'
  // 试行绿系已撤；曾选竹青/草地落到抹茶
  if (raw === 'bamboo' || raw === 'meadow') return 'matcha'
  if (raw && THEMES.has(raw)) return raw as AppTheme
  return 'light'
}

/** isDarkTheme 深色系，供编辑器 / 对比度分支使用。 */
export function isDarkTheme(theme: AppTheme): boolean {
  return theme === 'dark' || theme === 'olive' || theme === 'pink'
}

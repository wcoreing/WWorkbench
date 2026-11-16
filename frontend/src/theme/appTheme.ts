/** 应用外观主题（data-theme）。 */
export type AppTheme = 'light' | 'cream' | 'gold' | 'grass' | 'olive' | 'dark'

export const APP_THEMES: readonly AppTheme[] = ['light', 'cream', 'gold', 'grass', 'olive', 'dark'] as const

const THEMES = new Set<string>(APP_THEMES)

/** parseAppTheme 将设置值规范为合法主题。 */
export function parseAppTheme(raw: string | null | undefined): AppTheme {
  if (raw === 'ink') return 'olive'
  if (raw === 'khaki' || raw === 'maize') return 'gold'
  if (raw && THEMES.has(raw)) return raw as AppTheme
  return 'light'
}

/** isDarkTheme 深色系（深色 / 军绿），供编辑器 / 对比度分支使用。 */
export function isDarkTheme(theme: AppTheme): boolean {
  return theme === 'dark' || theme === 'olive'
}

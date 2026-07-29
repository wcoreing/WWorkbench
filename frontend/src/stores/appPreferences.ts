import type { ProductId } from '../shell/products'
import { api } from '../api/client'
import type { AppLocale } from '../i18n/types'
import { clampUiFontSize, DEFAULT_UI_FONT_SIZE, type UiFontSize } from '../shell/uiFontSize'

/** 应用设置键（与 Go store 常量一致）。 */
export const APP_SETTING_KEYS = {
  theme: 'theme',
  locale: 'locale',
  activeProduct: 'active_product',
  terminalOpacity: 'terminal_opacity',
  uiFontSize: 'ui_font_size',
  lastConnectionId: 'last_connection_id',
  lastDockerContextId: 'last_docker_context_id',
} as const

export interface AppPreferences {
  theme: 'light' | 'dark'
  locale: AppLocale
  activeProduct: ProductId
  terminalOpacity: number
  uiFontSize: UiFontSize
  lastConnectionId: string | null
  lastDockerContextId: string | null
}

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'light',
  locale: 'zh',
  activeProduct: 'database',
  terminalOpacity: 0.92,
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  lastConnectionId: null,
  lastDockerContextId: null,
}

/** parsePreferences 将后端设置映射为偏好对象。 */
function parsePreferences(settings: Record<string, string>): AppPreferences {
  const theme = settings[APP_SETTING_KEYS.theme] === 'dark' ? 'dark' : 'light'
  const localeRaw = settings[APP_SETTING_KEYS.locale]
  const locale: AppLocale = localeRaw === 'en' ? 'en' : 'zh'
  const product = settings[APP_SETTING_KEYS.activeProduct] as ProductId
  const activeProduct: ProductId =
    product === 'terminal' || product === 'sftp' || product === 'docker' || product === 'environment' || product === 'notebook'
      ? product
      : 'database'
  const opacity = Number(settings[APP_SETTING_KEYS.terminalOpacity])
  const fontRaw = Number(settings[APP_SETTING_KEYS.uiFontSize])
  return {
    theme,
    locale,
    activeProduct,
    terminalOpacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.4, opacity)) : 0.92,
    uiFontSize: Number.isFinite(fontRaw) ? clampUiFontSize(fontRaw) : DEFAULT_UI_FONT_SIZE,
    lastConnectionId: settings[APP_SETTING_KEYS.lastConnectionId] || null,
    lastDockerContextId: settings[APP_SETTING_KEYS.lastDockerContextId] || null,
  }
}

/** migratePreferencesFromLocalStorage 首次迁移 localStorage 偏好到 SQLite。 */
async function migratePreferencesFromLocalStorage(settings: Record<string, string>) {
  const pairs: Array<[string, string]> = []
  if (!settings[APP_SETTING_KEYS.theme]) {
    const v = localStorage.getItem('wn-theme')
    if (v === 'light' || v === 'dark') pairs.push([APP_SETTING_KEYS.theme, v])
  }
  if (!settings[APP_SETTING_KEYS.activeProduct]) {
    const v = localStorage.getItem('wn-product')
    if (v) pairs.push([APP_SETTING_KEYS.activeProduct, v])
  }
  if (!settings[APP_SETTING_KEYS.terminalOpacity]) {
    const v = localStorage.getItem('wn-terminal-opacity')
    if (v) pairs.push([APP_SETTING_KEYS.terminalOpacity, v])
  }
  if (!settings[APP_SETTING_KEYS.locale]) {
    const v = localStorage.getItem('wn-locale')
    if (v === 'zh' || v === 'en') pairs.push([APP_SETTING_KEYS.locale, v])
  }
  for (const [key, value] of pairs) {
    await api.setAppSetting(key, value)
    settings[key] = value
  }
}

/** loadAppPreferences 加载应用偏好（含 localStorage 迁移）。 */
export async function loadAppPreferences(): Promise<AppPreferences> {
  try {
    const settings = await api.listAppSettings()
    await migratePreferencesFromLocalStorage(settings)
    return parsePreferences(settings)
  } catch {
    return DEFAULT_PREFERENCES
  }
}

/** saveAppSetting 写入单项偏好。 */
export async function saveAppSetting(key: string, value: string) {
  try {
    await api.setAppSetting(key, value)
  } catch {
    /* ignore */
  }
}

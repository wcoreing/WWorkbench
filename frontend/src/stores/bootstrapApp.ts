import { waitForWails } from '../api/client'
import { applyDocumentLocale, translate } from '../i18n'
import { applyUiFontSize } from '../shell/uiFontSize'
import { Environment } from '../../wailsjs/runtime/runtime'
import { loadAppPreferences } from './appPreferences'
import { hydrateDatabaseWorkspace } from './databaseWorkspacePersist'
import { useAppStore } from './appStore'

/** applyPlatformAttr 标记宿主平台，供 CSS 让出红绿灯等系统控件。 */
async function applyPlatformAttr() {
  try {
    const env = await Environment()
    const platform = (env?.platform || '').toLowerCase()
    if (platform) document.documentElement.setAttribute('data-platform', platform)
  } catch {
    /* ignore */
  }
}

/** bootstrapAppState 启动时从 SQLite / dataDir 恢复偏好与工作区。 */
export async function bootstrapAppState() {
  await waitForWails()
  const [prefs, databaseWs] = await Promise.all([
    loadAppPreferences(),
    hydrateDatabaseWorkspace(),
    applyPlatformAttr(),
  ])
  document.documentElement.setAttribute('data-theme', prefs.theme)
  applyDocumentLocale(prefs.locale)
  applyUiFontSize(prefs.uiFontSize)
  useAppStore.setState({
    theme: prefs.theme,
    locale: prefs.locale,
    activeProduct: prefs.activeProduct,
    terminalOpacity: prefs.terminalOpacity,
    uiFontSize: prefs.uiFontSize,
    activeConnectionId: prefs.lastConnectionId,
    statusMessage: translate(prefs.locale, 'common.ready'),
    tabs: databaseWs.tabs,
    activeTabId: databaseWs.activeTabId,
    designDrafts: databaseWs.designDrafts,
    preferencesReady: true,
  })
  return prefs
}

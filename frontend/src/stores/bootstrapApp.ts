import { waitForWails } from '../api/client'
import { applyDocumentLocale, translate } from '../i18n'
import { applyUiFontSize } from '../shell/uiFontSize'
import { loadAppPreferences } from './appPreferences'
import { hydrateDatabaseWorkspace } from './databaseWorkspacePersist'
import { useAppStore } from './appStore'

/** bootstrapAppState 启动时从 SQLite / dataDir 恢复偏好与工作区。 */
export async function bootstrapAppState() {
  await waitForWails()
  const [prefs, databaseWs] = await Promise.all([loadAppPreferences(), hydrateDatabaseWorkspace()])
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

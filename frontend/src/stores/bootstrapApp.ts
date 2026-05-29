import { applyDocumentLocale, translate } from '../i18n'
import { loadAppPreferences } from './appPreferences'
import { hydrateDatabaseWorkspace } from './databaseWorkspacePersist'
import { useAppStore } from './appStore'

/** bootstrapAppState 启动时从 SQLite / dataDir 恢复偏好与工作区。 */
export async function bootstrapAppState() {
  const [prefs, databaseWs] = await Promise.all([loadAppPreferences(), hydrateDatabaseWorkspace()])
  document.documentElement.setAttribute('data-theme', prefs.theme)
  applyDocumentLocale(prefs.locale)
  useAppStore.setState({
    theme: prefs.theme,
    locale: prefs.locale,
    activeProduct: prefs.activeProduct,
    terminalOpacity: prefs.terminalOpacity,
    activeConnectionId: prefs.lastConnectionId,
    statusMessage: translate(prefs.locale, 'common.ready'),
    tabs: databaseWs.tabs,
    activeTabId: databaseWs.activeTabId,
    designDrafts: databaseWs.designDrafts,
    preferencesReady: true,
  })
  return prefs
}

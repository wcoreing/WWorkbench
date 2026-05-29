import { useLocalizedProduct } from '../i18n'
import { useAppStore } from '../stores/appStore'

/** 底部状态栏 */
export function StatusBar() {
  const { version, statusMessage, activeProduct, session } = useAppStore()
  const product = useLocalizedProduct(activeProduct)

  return (
    <footer className="app-statusbar">
      <span className="status-left">{statusMessage}</span>
      <span className="status-right">
        {product.label}
        {session?.database ? ` · ${session.database}` : ''}
        {' · '}v{version}
      </span>
    </footer>
  )
}

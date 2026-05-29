import { useAppStore } from '../stores/appStore'
import { getProduct } from './products'

/** 底部状态栏 */
export function StatusBar() {
  const { version, statusMessage, activeProduct, session } = useAppStore()
  const product = getProduct(activeProduct)

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

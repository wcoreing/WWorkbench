import { useLocalizedProduct } from '../i18n'
import { useAppStore } from '../stores/appStore'

/** 底部状态栏 */
export function StatusBar() {
  const { version, statusMessage, activeProduct, session, mcpStage } = useAppStore()
  const product = useLocalizedProduct(activeProduct)

  return (
    <footer className="app-statusbar">
      <span className="status-left">
        {mcpStage ? (
          <span className={`status-mcp-stage is-${mcpStage.kind}`} title={mcpStage.detail || mcpStage.label}>
            <span className="status-mcp-dot" aria-hidden />
            {mcpStage.label}
          </span>
        ) : (
          statusMessage
        )}
      </span>
      <span className="status-right">
        {product.label}
        {session?.database ? ` · ${session.database}` : ''}
        {' · '}v{version}
      </span>
    </footer>
  )
}

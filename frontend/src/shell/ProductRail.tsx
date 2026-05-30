import type { ProductId } from './products'
import { IconDatabase, IconDocker, IconFolder, IconHttp, IconLayers, IconNotebook, IconTerminal } from '../components/Icons'
import { useI18n, useLocalizedProducts } from '../i18n'
import { useAppStore } from '../stores/appStore'
import './shell.css'

const PRODUCT_ICONS: Record<ProductId, typeof IconDatabase> = {
  database: IconDatabase,
  terminal: IconTerminal,
  sftp: IconFolder,
  docker: IconDocker,
  environment: IconLayers,
  notebook: IconNotebook,
  httpapi: IconHttp,
}

/** 左侧产品线切换轨 */
export function ProductRail() {
  const { activeProduct, setActiveProduct } = useAppStore()
  const { t } = useI18n()
  const products = useLocalizedProducts()

  return (
    <nav className="product-rail" aria-label={t('shell.productRail')}>
      <div className="product-rail-main">
        {products.map((p) => {
          const Icon = PRODUCT_ICONS[p.id]
          return (
            <button
              key={p.id}
              type="button"
              className={`product-rail-btn ${activeProduct === p.id ? 'active' : ''}`}
              onClick={() => setActiveProduct(p.id)}
              title={`${p.label} — ${p.description}`}
              aria-current={activeProduct === p.id ? 'page' : undefined}
            >
              <Icon size={18} />
              <span className="product-rail-label">{p.shortLabel}</span>
              {!p.available && <span className="product-rail-badge" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

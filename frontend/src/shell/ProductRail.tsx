import type { ProductId } from './products'
import { IconDatabase, IconDocker, IconFolder, IconLayers, IconTerminal } from '../components/Icons'
import { useAppStore } from '../stores/appStore'
import { PRODUCTS } from './products'
import './shell.css'

const PRODUCT_ICONS: Record<ProductId, typeof IconDatabase> = {
  database: IconDatabase,
  terminal: IconTerminal,
  sftp: IconFolder,
  docker: IconDocker,
  environment: IconLayers,
}

/** 左侧产品线切换轨 */
export function ProductRail() {
  const { activeProduct, setActiveProduct } = useAppStore()

  return (
    <nav className="product-rail" aria-label="产品线">
      <div className="product-rail-main">
        {PRODUCTS.map((p) => {
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

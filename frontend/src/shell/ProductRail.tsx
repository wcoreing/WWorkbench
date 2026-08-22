import type { ProductId } from './products'
import { IconDatabase, IconDocker, IconFolder, IconFunction, IconHttp, IconLayers, IconLogs, IconNotebook, IconTerminal } from '../components/Icons'
import { chromeProps, pressProps } from '../components/compat'
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
  skills: IconFunction,
  httpapi: IconHttp,
  logs: IconLogs,
}

/** 左侧产品线切换轨 */
export function ProductRail() {
  const { activeProduct, setActiveProduct } = useAppStore()
  const { t } = useI18n()
  const products = useLocalizedProducts()

  return (
    <nav className="product-rail" aria-label={t('shell.productRail')} {...chromeProps()}>
      <div className="product-rail-main">
        {products.map((p) => {
          const Icon = PRODUCT_ICONS[p.id]
          return (
            <button
              key={p.id}
              type="button"
              data-product-id={p.id}
              className={`product-rail-btn ${activeProduct === p.id ? 'active' : ''}`}
              title={`${p.label} — ${p.description}`}
              aria-current={activeProduct === p.id ? 'page' : undefined}
              {...pressProps(() => setActiveProduct(p.id))}
            >
              <Icon size={22} />
              <span className="product-rail-label">{p.shortLabel}</span>
              {!p.available && <span className="product-rail-badge" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

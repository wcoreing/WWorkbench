import { IconMoon, IconSun } from '../components/Icons'
import { useAppStore } from '../stores/appStore'
import { getProduct } from './products'

/** 应用顶栏：品牌、当前产品、主题切换 */
export function ShellChrome() {
  const { theme, setTheme, activeProduct } = useAppStore()
  const product = getProduct(activeProduct)

  return (
    <header className="shell-chrome">
      <div className="chrome-brand">
        <span className="logo-mark">WW</span>
        <span className="logo-text">WWorkbench</span>
      </div>
      <span className="chrome-vrule" />
      <div className="chrome-product">
        <span className="chrome-product-name">{product.label}</span>
        <span className="chrome-product-desc">{product.description}</span>
      </div>
      <span className="chrome-spacer" />
      <button
        type="button"
        className="wn-btn wn-btn-chrome wn-btn-icon-only"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title="切换主题"
      >
        {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />}
      </button>
    </header>
  )
}

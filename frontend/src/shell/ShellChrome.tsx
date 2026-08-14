import { IconMoon, IconSun } from '../components/Icons'
import { useI18n, useLocalizedProduct } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { ShellFontSizeMenu } from './ShellFontSizeMenu'
import { ShellLocaleMenu } from './ShellLocaleMenu'
import appMark from '../assets/brand/mark.png'

/** 应用顶栏：品牌、当前产品、主题与语言切换 */
export function ShellChrome({
  agentOpen,
  onToggleAgent,
}: {
  agentOpen?: boolean
  onToggleAgent?: () => void
}) {
  const { theme, setTheme, activeProduct } = useAppStore()
  const { t } = useI18n()
  const product = useLocalizedProduct(activeProduct)

  return (
    <header className="shell-chrome">
      <div className="chrome-brand">
        <img className="logo-mark-img" src={appMark} alt="" width={22} height={22} />
        <span className="logo-text">WWorkbench</span>
      </div>
      <span className="chrome-vrule" />
      <div className="chrome-product">
        <span className="chrome-product-name">{product.label}</span>
        <span className="chrome-product-desc">{product.description}</span>
      </div>
      <span className="chrome-spacer" />
      {onToggleAgent && (
        <button
          type="button"
          className={`wn-btn wn-btn-chrome wn-btn-sm${agentOpen ? ' active' : ''}`}
          onClick={onToggleAgent}
          title={agentOpen ? t('agent.collapsePanel') : t('agent.openPanel')}
        >
          AI
        </button>
      )}
      <ShellFontSizeMenu />
      <ShellLocaleMenu />
      <button
        type="button"
        className="wn-btn wn-btn-chrome wn-btn-icon-only"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={t('shell.switchTheme')}
      >
        {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />}
      </button>
    </header>
  )
}

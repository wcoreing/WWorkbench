import { chromeProps, pressProps } from '../components/compat'
import { useI18n, useLocalizedProduct } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { ShellSettingsMenu } from './ShellSettingsMenu'
import appMark from '../assets/brand/mark.png'

/** 应用顶栏：品牌、当前产品、AI；外观类设置收进齿轮菜单。 */
export function ShellChrome({
  agentOpen,
  onToggleAgent,
}: {
  agentOpen?: boolean
  onToggleAgent?: () => void
}) {
  const { activeProduct } = useAppStore()
  const { t } = useI18n()
  const product = useLocalizedProduct(activeProduct)

  return (
    <header className="shell-chrome" {...chromeProps()}>
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
          className={`wn-btn wn-btn-chrome chrome-ai-btn${agentOpen ? ' active' : ''}`}
          title={agentOpen ? t('agent.collapsePanel') : t('agent.openPanel')}
          aria-pressed={agentOpen}
          {...pressProps(() => onToggleAgent())}
        >
          <span className="chrome-ai-label">AI</span>
        </button>
      )}
      <ShellSettingsMenu />
    </header>
  )
}

import { chromeProps, pressProps } from '../components/compat'
import { IconUiPin } from '../components/ShellChromeIcons'
import { useI18n, useLocalizedProduct } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { ShellAccountMenu } from './ShellAccountMenu'
import { ShellSettingsMenu } from './ShellSettingsMenu'
import appMark from '../assets/brand/mark.png'

/** 应用顶栏：品牌、当前产品、置顶、AI；外观类设置收进齿轮菜单。 */
export function ShellChrome({
  agentOpen,
  onToggleAgent,
}: {
  agentOpen?: boolean
  onToggleAgent?: () => void
}) {
  const activeProduct = useAppStore((s) => s.activeProduct)
  const alwaysOnTop = useAppStore((s) => s.alwaysOnTop)
  const setAlwaysOnTop = useAppStore((s) => s.setAlwaysOnTop)
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
      <button
        type="button"
        className={`wn-btn wn-btn-chrome wn-btn-icon-only${alwaysOnTop ? ' active' : ''}`}
        title={alwaysOnTop ? t('shell.unpinWindow') : t('shell.pinWindow')}
        aria-pressed={alwaysOnTop}
        {...pressProps(() => setAlwaysOnTop(!alwaysOnTop))}
      >
        <IconUiPin />
      </button>
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
      <ShellAccountMenu />
      <ShellSettingsMenu />
    </header>
  )
}

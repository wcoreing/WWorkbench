import { useEffect, useRef, useState } from 'react'
import type { AppLocale } from '../i18n/types'
import { useI18n } from '../i18n'
import { IconUiGlobe } from '../components/ShellChromeIcons'
import { useAppStore } from '../stores/appStore'
import { pressProps, useDismissOverlays } from '../components/compat'

const LOCALE_OPTIONS: Array<{ id: AppLocale; labelKey: string }> = [
  { id: 'zh', labelKey: 'shell.langZh' },
  { id: 'en', labelKey: 'shell.langEn' },
]

/** ShellLocaleMenu 顶栏语言切换菜单。 */
export function ShellLocaleMenu() {
  const { locale, setLocale } = useAppStore()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useDismissOverlays(() => setOpen(false))

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="shell-locale-menu" ref={rootRef}>
      <button
        type="button"
        className="wn-btn wn-btn-chrome wn-btn-icon-only"
        title={t('shell.language')}
        aria-haspopup="menu"
        aria-expanded={open}
        {...pressProps(() => setOpen((v) => !v))}
      >
        <IconUiGlobe />
      </button>
      {open && (
        <div className="shell-locale-dropdown" role="menu">
          {LOCALE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitemradio"
              aria-checked={locale === opt.id}
              className={`shell-locale-item${locale === opt.id ? ' active' : ''}`}
              {...pressProps(() => {
                setLocale(opt.id)
                setOpen(false)
              })}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

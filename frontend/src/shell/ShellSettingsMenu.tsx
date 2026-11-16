import { useEffect, useRef, useState } from 'react'
import type { AppLocale } from '../i18n/types'
import { IconUiSettings } from '../components/ShellChromeIcons'
import { pressProps, useDismissOverlays } from '../components/compat'
import { useI18n } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { APP_THEMES, type AppTheme } from '../theme/appTheme'
import { DEFAULT_UI_FONT_SIZE, UI_FONT_SIZES } from './uiFontSize'

const THEME_LABEL_KEYS: Record<AppTheme, string> = {
  light: 'shell.themeLight',
  cream: 'shell.themeCream',
  gold: 'shell.themeGold',
  grass: 'shell.themeGrass',
  olive: 'shell.themeOlive',
  dark: 'shell.themeDark',
}

const LOCALE_OPTIONS: Array<{ id: AppLocale; labelKey: string }> = [
  { id: 'zh', labelKey: 'shell.langZh' },
  { id: 'en', labelKey: 'shell.langEn' },
]

/** ShellSettingsMenu 顶栏设置：主题 / 语言 / 字号（低频项收纳，顶栏只留 AI）。 */
export function ShellSettingsMenu() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const setUiFontSize = useAppStore((s) => s.setUiFontSize)
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
        className={`wn-btn wn-btn-chrome wn-btn-icon-only${open ? ' active' : ''}`}
        title={t('shell.settings')}
        aria-haspopup="menu"
        aria-expanded={open}
        {...pressProps(() => setOpen((v) => !v))}
      >
        <IconUiSettings />
      </button>
      {open && (
        <div className="shell-locale-dropdown shell-settings-dropdown" role="menu">
          <div className="shell-settings-section" role="group" aria-label={t('shell.theme')}>
            <div className="shell-settings-label">{t('shell.theme')}</div>
            {APP_THEMES.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={theme === id}
                className={`shell-locale-item${theme === id ? ' active' : ''}`}
                {...pressProps(() => setTheme(id))}
              >
                {t(THEME_LABEL_KEYS[id])}
              </button>
            ))}
          </div>

          <div className="shell-settings-sep" />

          <div className="shell-settings-section" role="group" aria-label={t('shell.language')}>
            <div className="shell-settings-label">{t('shell.language')}</div>
            {LOCALE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={locale === opt.id}
                className={`shell-locale-item${locale === opt.id ? ' active' : ''}`}
                {...pressProps(() => setLocale(opt.id))}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          <div className="shell-settings-sep" />

          <div className="shell-settings-section" role="group" aria-label={t('shell.fontSize')}>
            <div className="shell-settings-label">{t('shell.fontSize')}</div>
            {UI_FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="menuitemradio"
                aria-checked={uiFontSize === size}
                className={`shell-locale-item shell-settings-fontsize-item${uiFontSize === size ? ' active' : ''}`}
                title={size >= 16 ? t('shell.fontSizeComfortHint') : undefined}
                {...pressProps(() => setUiFontSize(size))}
              >
                <span className="shell-fontsize-label" style={{ fontSize: size }}>
                  {size}px
                </span>
                {size === DEFAULT_UI_FONT_SIZE ? (
                  <span className="shell-fontsize-tag">{t('shell.fontSizeDefault')}</span>
                ) : size >= 16 ? (
                  <span className="shell-fontsize-tag">{t('shell.fontSizeComfort')}</span>
                ) : null}
              </button>
            ))}
            <p className="shell-settings-hint">{t('shell.fontSizeDesc')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

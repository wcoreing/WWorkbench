import { useEffect, useRef, useState } from 'react'
import { IconFontSize } from '../components/Icons'
import { useI18n } from '../i18n'
import { useAppStore } from '../stores/appStore'
import { DEFAULT_UI_FONT_SIZE, UI_FONT_SIZES } from './uiFontSize'

/** ShellFontSizeMenu 顶栏界面字号菜单。 */
export function ShellFontSizeMenu() {
  const uiFontSize = useAppStore((s) => s.uiFontSize)
  const setUiFontSize = useAppStore((s) => s.setUiFontSize)
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="shell-locale-menu" ref={rootRef}>
      <button
        type="button"
        className="wn-btn wn-btn-chrome wn-btn-icon-only"
        title={t('shell.fontSize')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconFontSize size={13} />
      </button>
      {open && (
        <div className="shell-locale-dropdown shell-fontsize-dropdown" role="menu">
          {UI_FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="menuitemradio"
              aria-checked={uiFontSize === size}
              className={`shell-locale-item${uiFontSize === size ? ' active' : ''}`}
              onClick={() => {
                setUiFontSize(size)
                setOpen(false)
              }}
            >
              <span className="shell-fontsize-label" style={{ fontSize: size }}>
                {size}px
              </span>
              {size === DEFAULT_UI_FONT_SIZE && (
                <span className="shell-fontsize-tag">{t('shell.fontSizeDefault')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

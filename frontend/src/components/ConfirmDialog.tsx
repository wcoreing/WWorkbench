import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import { ModalPortal, pressProps } from './compat'
import './ui.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}

/** ConfirmDialog 应用内确认弹窗（Wails 中 window.confirm 不可用）。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const okLabel = confirmLabel ?? t('common.confirm')

  if (!open) return null

  return (
    <ModalPortal>
    <div
      className="wn-modal-backdrop wn-modal-backdrop-top ssh-trust-backdrop"
      {...pressProps(onCancel)}
    >
      <div
        className="wn-modal wn-modal-compact ssh-trust-dialog"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="confirm-dialog-title"
      >
        <header className="wn-modal-header">
          <h2 id="confirm-dialog-title" className="wn-modal-title">
            {title}
          </h2>
          {message && <p className="wn-modal-desc">{message}</p>}
        </header>
        {children ? <div className="wn-modal-body">{children}</div> : null}
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" {...pressProps(onCancel)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`wn-btn wn-btn-sm ${danger ? 'wn-btn-danger' : 'wn-btn-primary'}`}
            {...pressProps(onConfirm)}
          >
            {okLabel}
          </button>
        </footer>
      </div>
    </div>
    </ModalPortal>
  )
}

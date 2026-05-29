import { useI18n } from '../i18n'
import './ui.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const okLabel = confirmLabel ?? t('common.confirm')

  if (!open) return null

  return (
    <div className="wn-modal-backdrop ssh-trust-backdrop" onClick={onCancel}>
      <div
        className="wn-modal wn-modal-compact ssh-trust-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="confirm-dialog-title"
      >
        <header className="wn-modal-header">
          <h2 id="confirm-dialog-title" className="wn-modal-title">
            {title}
          </h2>
          {message && <p className="wn-modal-desc">{message}</p>}
        </header>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`wn-btn wn-btn-sm ${danger ? 'wn-btn-danger' : 'wn-btn-primary'}`}
            onClick={onConfirm}
          >
            {okLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

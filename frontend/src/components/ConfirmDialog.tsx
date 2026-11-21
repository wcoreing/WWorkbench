import type { ReactNode } from 'react'
import { useI18n, useLocalizedProduct } from '../i18n'
import type { ProductId } from '../shell/products'
import { PRODUCTS } from '../shell/products'
import type { ConfirmLedgerRow } from '../utils/askConfirm'
import { ModalPortal, backdropDismissProps, pressProps } from './compat'
import './ui.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  ledger?: ConfirmLedgerRow[]
  /** 命令/SQL 等，以等宽代码块展示 */
  code?: string
  /** 触及的产品线 */
  product?: ProductId
  confirmLabel?: string
  cancelLabel?: string
  /** 非硬风险：显示「信任并执行」 */
  allowTrust?: boolean
  danger?: boolean
  /** 硬风险：不可免确认 */
  hardRisk?: boolean
  /** 软风险：可被目录护照免除，本次仍拍板 */
  softRisk?: boolean
  /** center 居中；corner 右下角（MCP 拍板） */
  placement?: 'center' | 'corner'
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
  onTrust?: () => void
}

function isProductId(id: string | undefined): id is ProductId {
  return !!id && PRODUCTS.some((p) => p.id === id)
}

/** ConfirmDialog 应用内确认弹窗（拍板唯一入口）。 */
export function ConfirmDialog({
  open,
  title,
  message,
  ledger,
  code,
  product,
  confirmLabel,
  cancelLabel,
  allowTrust = false,
  danger = false,
  hardRisk = false,
  softRisk = false,
  placement = 'center',
  children,
  onConfirm,
  onCancel,
  onTrust,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const productId = isProductId(product) ? product : 'terminal'
  const productMeta = useLocalizedProduct(productId)
  const okLabel = confirmLabel ?? t('common.confirm')
  const noLabel = cancelLabel ?? t('common.cancel')
  const showTrust = !hardRisk && allowTrust && !!onTrust
  const hasCode = Boolean(code?.trim())
  const corner = placement === 'corner'
  const showProduct = isProductId(product)
  const rows = ledger?.length ? ledger : undefined

  if (!open) return null

  const panel = (
    <div
      className={`wn-modal wn-modal-compact is-confirm${hasCode ? ' is-code-confirm' : ''}${hardRisk ? ' is-hard-risk' : ''}${softRisk ? ' is-soft-risk' : ''}${corner ? ' is-corner-confirm' : ''}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-labelledby="confirm-dialog-title"
    >
      <header className="wn-modal-header">
        <div className="wn-confirm-title-row">
          {showProduct ? (
            <span className="wn-modal-tag wn-confirm-product">{productMeta.label}</span>
          ) : null}
          {hardRisk ? (
            <span className="wn-modal-tag wn-confirm-risk-tag is-hard">{t('shell.confirmHardTag')}</span>
          ) : softRisk ? (
            <span className="wn-modal-tag wn-confirm-risk-tag is-soft">{t('shell.confirmSoftTag')}</span>
          ) : null}
          <h2 id="confirm-dialog-title" className="wn-modal-title">
            {title}
          </h2>
        </div>
        {hardRisk ? <p className="wn-confirm-hard-risk">{t('shell.confirmHardRisk')}</p> : null}
        {softRisk && !hardRisk ? <p className="wn-confirm-soft-risk">{t('shell.confirmSoftRisk')}</p> : null}
        {rows ? (
          <ul className="wn-confirm-ledger-list">
            {rows.map((row, i) => (
              <li key={`${row.label}-${i}`} className={`wn-confirm-ledger-row${row.tone ? ` is-${row.tone}` : ''}`}>
                <span className="wn-confirm-ledger-k">{row.label}</span>
                <span className="wn-confirm-ledger-v">{row.value}</span>
              </li>
            ))}
          </ul>
        ) : message ? (
          <p className="wn-modal-desc wn-confirm-ledger">{message}</p>
        ) : null}
      </header>
      {hasCode ? (
        <div className="wn-modal-body wn-confirm-code-wrap">
          <pre className="wn-confirm-code" tabIndex={0}>
            {code}
          </pre>
        </div>
      ) : null}
      {children ? <div className="wn-modal-body">{children}</div> : null}
      <footer className="wn-modal-footer">
        <button type="button" className="wn-btn wn-btn-tool" {...pressProps(onCancel)}>
          {noLabel}
        </button>
        {showTrust ? (
          <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" {...pressProps(onTrust)}>
            {t('shell.confirmTrust')}
          </button>
        ) : null}
        <button
          type="button"
          className={`wn-btn wn-btn-sm ${danger ? 'wn-btn-danger' : 'wn-btn-primary'}`}
          {...pressProps(onConfirm)}
        >
          {okLabel}
        </button>
      </footer>
    </div>
  )

  if (corner) {
    return (
      <ModalPortal>
        <div className="wn-confirm-corner-host" aria-live="assertive">
          {panel}
        </div>
      </ModalPortal>
    )
  }

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" {...backdropDismissProps(onCancel)}>
        {panel}
      </div>
    </ModalPortal>
  )
}

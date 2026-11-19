import type { ReactNode } from 'react'
import { useI18n, useLocalizedProduct } from '../i18n'
import type { ProductId } from '../shell/products'
import { PRODUCTS } from '../shell/products'
import { ModalPortal, backdropDismissProps, pressProps } from './compat'
import './ui.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  /** 命令/SQL 等，以等宽代码块展示 */
  code?: string
  /** 触及的产品线（加强弹窗：承接原共视条的产品信号） */
  product?: ProductId
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** 硬风险：不可免确认，账本提示 */
  hardRisk?: boolean
  /** center 居中；corner 右下角（MCP 拍板） */
  placement?: 'center' | 'corner'
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}

function isProductId(id: string | undefined): id is ProductId {
  return !!id && PRODUCTS.some((p) => p.id === id)
}

/** ConfirmDialog 应用内确认弹窗（拍板唯一入口；Wails 中 window.confirm 不可用）。 */
export function ConfirmDialog({
  open,
  title,
  message,
  code,
  product,
  confirmLabel,
  cancelLabel,
  danger = false,
  hardRisk = false,
  placement = 'center',
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const productId = isProductId(product) ? product : 'terminal'
  const productMeta = useLocalizedProduct(productId)
  const okLabel = confirmLabel ?? t('common.confirm')
  const noLabel = cancelLabel ?? t('common.cancel')
  const hasCode = Boolean(code?.trim())
  const corner = placement === 'corner'
  const showProduct = isProductId(product)

  if (!open) return null

  const panel = (
    <div
      className={`wn-modal wn-modal-compact is-confirm${hasCode ? ' is-code-confirm' : ''}${hardRisk ? ' is-hard-risk' : ''}${corner ? ' is-corner-confirm' : ''}`}
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
          <h2 id="confirm-dialog-title" className="wn-modal-title">
            {title}
          </h2>
        </div>
        {hardRisk ? <p className="wn-confirm-hard-risk">{t('shell.confirmHardRisk')}</p> : null}
        {message ? <p className="wn-modal-desc wn-confirm-ledger">{message}</p> : null}
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

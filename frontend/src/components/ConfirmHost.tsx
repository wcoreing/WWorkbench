import { useEffect, useState, useSyncExternalStore } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import {
  getConfirmDialogState,
  resolveConfirm,
  subscribeConfirmDialog,
} from '../utils/askConfirm'
import { useI18n } from '../i18n'

/** ConfirmHost 全局确认弹窗（配合 askConfirm）。 */
export function ConfirmHost() {
  const { t } = useI18n()
  const req = useSyncExternalStore(subscribeConfirmDialog, getConfirmDialogState, getConfirmDialogState)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    if (!req?.choices?.length) {
      setSelectedIds([])
      return
    }
    setSelectedIds(
      req.choices.filter((c) => c.defaultChecked !== false).map((c) => c.id),
    )
  }, [req])

  return (
    <ConfirmDialog
      open={!!req}
      title={req?.title ?? ''}
      message={req?.message}
      ledger={req?.ledger}
      choices={req?.choices}
      selectedIds={selectedIds}
      onToggleChoice={(id) => {
        setSelectedIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        )
      }}
      code={req?.code}
      product={req?.product}
      confirmLabel={req?.confirmLabel ?? t('common.confirm')}
      cancelLabel={req?.cancelLabel}
      allowTrust={req?.allowTrust}
      danger={req?.danger}
      hardRisk={req?.hardRisk}
      softRisk={req?.softRisk}
      placement={req?.placement}
      onConfirm={() => resolveConfirm(true, false, selectedIds)}
      onCancel={() => resolveConfirm(false)}
      onTrust={req?.allowTrust ? () => resolveConfirm(true, true, selectedIds) : undefined}
    />
  )
}

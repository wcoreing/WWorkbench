import { useSyncExternalStore } from 'react'
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

  return (
    <ConfirmDialog
      open={!!req}
      title={req?.title ?? ''}
      message={req?.message}
      confirmLabel={req?.confirmLabel ?? t('common.confirm')}
      danger={req?.danger}
      onConfirm={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
    />
  )
}

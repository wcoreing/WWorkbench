import { createPortal } from 'react-dom'
import { pressProps } from '../components/compat'
import { useI18n } from '../i18n'
import { notify } from './notify'
import { useNotifyStore } from './notifyStore'
import type { NotifyItem } from './types'

function NotifyCard({ item }: { item: NotifyItem }) {
  const { t } = useI18n()
  const copyDetail = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify.info(t('common.copied'))
    } catch {
      /* ignore */
    }
  }
  return (
    <div className={`wwb-notify is-${item.kind}`} role="status">
      <div className="wwb-notify-body">
        {item.title ? <div className="wwb-notify-title">{item.title}</div> : null}
        <div className="wwb-notify-message">{item.message}</div>
        {item.detail ? (
          <button
            type="button"
            className="wwb-notify-detail"
            title={t('common.copy')}
            {...pressProps(() => void copyDetail(item.detail!))}
          >
            {item.detail}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="wwb-notify-close"
        aria-label={t('common.close')}
        {...pressProps(() => notify.dismiss(item.id))}
      >
        ×
      </button>
    </div>
  )
}

/** NotifyHost 壳层通知栈（右下，避开底栏与 Agent）。 */
export function NotifyHost() {
  const items = useNotifyStore((s) => s.items)
  if (items.length === 0 || typeof document === 'undefined') return null
  return createPortal(
    <div className="wwb-notify-host" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <NotifyCard key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  )
}

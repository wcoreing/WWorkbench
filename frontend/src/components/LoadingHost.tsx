import type { CSSProperties, ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useLoading } from '../stores/loadingStore'
import { Loading } from './Loading'

type LoadingPaneProps = {
  loadingKey: string
  children: ReactNode
  /** 无 store label 时的兜底文案 */
  label?: string
  className?: string
  style?: CSSProperties
  minHeight?: number | string
}

/** LoadingPane 加载中占据内容区，否则渲染子节点。 */
export function LoadingPane({ loadingKey, children, label, className, style, minHeight }: LoadingPaneProps) {
  const { t } = useI18n()
  const loading = useLoading(loadingKey)

  if (loading.active) {
    return (
      <div
        className={['wn-loading-pane-host', className].filter(Boolean).join(' ')}
        style={{ minHeight, ...style }}
      >
        <Loading variant="pane" label={loading.label || label || t('common.loading')} />
      </div>
    )
  }

  return <>{children}</>
}

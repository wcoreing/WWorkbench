import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { LogSource, LogSourceType } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { useI18n } from '../../../i18n'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** LogResourceSurface 嵌入式日志尾读（只读 tail，可刷新）。 */
export function LogResourceSurface({ window: win }: Props) {
  const { t } = useI18n()
  const [source, setSource] = useState<LogSource | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const tail = Math.max(50, source?.tailLines || 200)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const list = await api.listLogSources()
      const hit = list.find((s) => s.id === win.resourceId)
      if (!hit) throw new Error(t('resourceWindow.logMissing'))
      // Wails DO 的 sourceType 为 string，收窄为业务联合类型
      setSource({ ...hit, sourceType: hit.sourceType as LogSourceType })
      const n = Math.max(50, hit.tailLines || 200)
      const res = await api.fetchLogSource(hit.id, n, 0)
      setContent(res.content || '')
    } catch (e) {
      setError((e as Error).message)
      setContent('')
    } finally {
      setBusy(false)
    }
  }, [t, win.resourceId])

  useEffect(() => {
    void load()
  }, [load])

  if (error && !source) {
    return (
      <div className="rw-surface rw-surface-log">
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[{ label: t('common.retry'), onPress: () => void load(), primary: true }]}
        />
      </div>
    )
  }

  return (
    <div className="rw-surface rw-surface-log">
      <div className="rw-surface-toolbar">
        <span className="rw-surface-meta" title={source?.path || win.resourceId}>
          {source ? `${source.sourceType} · ${source.path || source.containerId || source.name}` : win.title}
        </span>
        <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={busy} {...pressProps(() => void load())}>
          {busy ? t('shell.loadingProduct') : t('common.refresh')}
        </button>
      </div>
      {error ? <p className="rw-surface-error">{error}</p> : null}
      <pre className="rw-log-pre" aria-label={t('resourceWindow.logTail', { n: String(tail) })}>
        {content || (busy ? '' : t('resourceWindow.logEmpty'))}
      </pre>
    </div>
  )
}

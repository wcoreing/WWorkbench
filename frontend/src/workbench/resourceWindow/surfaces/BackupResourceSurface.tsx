import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { BackupPolicy, BackupRun } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { useI18n } from '../../../i18n'
import { openAsProduct } from '../openResource'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** BackupResourceSurface 嵌入式备份策略：信息、最近运行、手动跑一轮。 */
export function BackupResourceSurface({ window: win }: Props) {
  const { t } = useI18n()
  const [policy, setPolicy] = useState<BackupPolicy | null>(null)
  const [runs, setRuns] = useState<BackupRun[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const list = await api.listBackupPolicies()
      const hit = list.find((p) => p.id === win.resourceId)
      if (!hit) throw new Error(t('resourceWindow.backupMissing'))
      setPolicy(hit)
      const rs = await api.listBackupRuns(hit.id, 12)
      setRuns(rs)
    } catch (e) {
      setError((e as Error).message)
      setRuns([])
    } finally {
      setBusy(false)
    }
  }, [t, win.resourceId])

  useEffect(() => {
    void load()
  }, [load])

  const runNow = async () => {
    if (!policy) return
    setBusy(true)
    setError('')
    try {
      await api.runBackupPolicy(policy.id, t('resourceWindow.backupManualIntent'), false)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !policy) {
    return (
      <div className="rw-surface rw-surface-backup">
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[
            { label: t('common.retry'), onPress: () => void load(), primary: true },
            {
              label: t('resourceWindow.openInProduct'),
              onPress: () => openAsProduct({ kind: 'backup', resourceId: win.resourceId, title: win.title }),
            },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="rw-surface rw-surface-backup">
      <div className="rw-surface-toolbar">
        <span className="rw-surface-meta" title={policy?.path || ''}>
          {policy
            ? `${policy.name} · ${policy.kind}${policy.enabled ? '' : ` · ${t('resourceWindow.backupDisabled')}`}`
            : win.title}
        </span>
        <div className="rw-surface-toolbar-right">
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={busy || !policy} {...pressProps(() => void runNow())}>
            {t('resourceWindow.backupRun')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-tool"
            {...pressProps(() =>
              openAsProduct({ kind: 'backup', resourceId: win.resourceId, title: win.title }),
            )}
          >
            {t('resourceWindow.openInProduct')}
          </button>
        </div>
      </div>
      {policy ? (
        <div className="rw-backup-meta">
          <div>
            <span className="rw-backup-k">{t('resourceWindow.backupPath')}</span>
            <span className="rw-backup-v" title={policy.path}>
              {policy.path || '—'}
            </span>
          </div>
          <div>
            <span className="rw-backup-k">{t('resourceWindow.backupDest')}</span>
            <span className="rw-backup-v" title={policy.destRoot}>
              {policy.destRoot || '—'}
            </span>
          </div>
          <div>
            <span className="rw-backup-k">cron</span>
            <span className="rw-backup-v">{policy.cronExpr || t('resourceWindow.backupNoCron')}</span>
          </div>
        </div>
      ) : null}
      {error ? <p className="rw-surface-error">{error}</p> : null}
      <ul className="rw-backup-runs">
        {runs.length === 0 ? (
          <li className="rw-surface-muted">{busy ? t('shell.loadingProduct') : t('resourceWindow.backupRunsEmpty')}</li>
        ) : (
          runs.map((r) => (
            <li key={r.id} className="rw-backup-run">
              <span className="rw-backup-run-status" data-status={r.status}>
                {r.status}
              </span>
              <span className="rw-backup-run-detail" title={r.destPath || r.detail}>
                {r.trigger} · {r.detail || r.destPath || r.id}
              </span>
              <span className="rw-backup-run-time">
                {r.createdAt
                  ? new Date(r.createdAt * (r.createdAt < 1e12 ? 1000 : 1)).toLocaleString()
                  : ''}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

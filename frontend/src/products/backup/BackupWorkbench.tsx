import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { BackupPolicy, BackupRun, Connection, SSHHost } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { IconPlus, IconPlay, IconRefresh, IconSave, IconTrash } from '../../components/Icons'
import { Select, pressProps } from '../../components/compat'
import { SftpPathPicker, type SftpPathPickMode } from '../../features/sftp/SftpPathPicker'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadBool, payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged } from '../../workbench/workbenchRadar'
import { model } from '../../../wailsjs/go/models'
import {
  HOUR_OPTIONS,
  WEEKDAY_OPTIONS,
  buildBackupCron,
  defaultSchedule,
  formatHourLabel,
  parseBackupCron,
  toggleNumber,
  type BackupSchedule,
} from './backupSchedule'
import './backup.css'

const KIND_LABEL: Record<BackupPolicy['kind'], string> = {
  files: 'backup.kindFiles',
  sqlite: 'backup.kindSqlite',
  db: 'backup.kindDb',
}

type RetainMode = 'days' | 'count'

function emptyDraft(): BackupPolicy {
  return {
    id: '',
    name: '',
    kind: 'files',
    sshHostId: '',
    connectionId: '',
    path: '',
    destRoot: '/www/backup/wworkbench',
    beforeWrite: true,
    retainDays: 7,
    retainCount: 0,
    cronExpr: '',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function toDO(p: BackupPolicy): model.BackupPolicyDO {
  return model.BackupPolicyDO.createFrom({
    id: p.id,
    name: p.name,
    kind: p.kind,
    sshHostId: p.sshHostId,
    connectionId: p.connectionId,
    path: p.path,
    destRoot: p.destRoot,
    beforeWrite: p.beforeWrite,
    retainDays: p.retainDays,
    retainCount: p.retainCount,
    cronExpr: p.cronExpr || '',
    enabled: p.enabled,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  })
}

function normalizePolicy(p: BackupPolicy): BackupPolicy {
  const base = emptyDraft()
  return {
    ...base,
    ...p,
    retainDays: typeof p.retainDays === 'number' ? p.retainDays : base.retainDays,
    retainCount: typeof p.retainCount === 'number' ? p.retainCount : base.retainCount,
    cronExpr: p.cronExpr || '',
  }
}

function retainModeOf(p: BackupPolicy): RetainMode {
  return p.retainDays > 0 ? 'days' : 'count'
}

/** BackupWorkbench 备份策略资产工作台（定时/保留对齐云盘快照策略）。 */
export function BackupWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setActiveProduct } = useAppStore()
  const [items, setItems] = useState<BackupPolicy[]>([])
  const [runs, setRuns] = useState<BackupRun[]>([])
  const [hosts, setHosts] = useState<SSHHost[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState<BackupPolicy>(emptyDraft())
  const [deleteTarget, setDeleteTarget] = useState<BackupPolicy | null>(null)
  const [busy, setBusy] = useState(false)
  const [scheduleOn, setScheduleOn] = useState(false)
  const [schedule, setSchedule] = useState<BackupSchedule>(defaultSchedule())
  const [pathPicker, setPathPicker] = useState<{
    field: 'path' | 'destRoot'
    mode: SftpPathPickMode
  } | null>(null)

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId])
  const retainMode = retainModeOf(draft)

  const scheduleSummary = useMemo(() => {
    if (!scheduleOn || !schedule.weekdays.length || !schedule.hours.length) return ''
    const days = WEEKDAY_OPTIONS.filter((o) => schedule.weekdays.includes(o.value))
      .map((o) => t(o.labelKey))
      .join('、')
    const hours = schedule.hours.map(formatHourLabel).join('、')
    return `${days} · ${hours}`
  }, [schedule, scheduleOn, t])

  /** 只接受傻瓜日程；旧复杂 cron 回落到默认可视日程。 */
  const applyCronToUI = (cronExpr: string): string => {
    const expr = cronExpr.trim()
    if (!expr) {
      setScheduleOn(false)
      setSchedule(defaultSchedule())
      return ''
    }
    const parsed = parseBackupCron(expr) || defaultSchedule()
    setScheduleOn(true)
    setSchedule(parsed)
    return buildBackupCron(parsed)
  }

  const patchSchedule = (next: BackupSchedule) => {
    setSchedule(next)
    setDraft((d) => ({ ...d, cronExpr: buildBackupCron(next) }))
  }

  const refresh = useCallback(async () => {
    const [list, hs, cs] = await Promise.all([
      api.listBackupPolicies(),
      api.listSSHHosts(),
      api.listConnections(),
    ])
    const normalized = list.map((p) => normalizePolicy(p))
    setItems(normalized)
    setHosts(hs)
    setConnections(cs)
    return normalized
  }, [])

  const refreshRuns = useCallback(async (policyId: string) => {
    const list = await api.listBackupRuns(policyId, 30)
    setRuns(list)
  }, [])

  useEffect(() => {
    void refresh().catch((err) => setStatusMessage(err instanceof Error ? err.message : String(err)))
  }, [refresh, setStatusMessage])

  useEffect(() => {
    if (!activeId) {
      setRuns([])
      return
    }
    void refreshRuns(activeId).catch(() => setRuns([]))
  }, [activeId, refreshRuns])

  useEffect(() => {
    return subscribeWorkbenchChanged((evt) => {
      if (evt.domain !== 'backup.policy') return
      void refresh().then((list) => {
        if (evt.reveal && evt.ids[0]) {
          const hit = list.find((i) => i.id === evt.ids[0])
          if (hit) {
            setActiveId(hit.id)
            const cronExpr = applyCronToUI(hit.cronExpr)
            setDraft({ ...hit, cronExpr })
            setActiveProduct('backup')
          }
        }
      })
    })
  }, [refresh, setActiveProduct])

  const selectItem = (item: BackupPolicy) => {
    const next = normalizePolicy(item)
    const cronExpr = applyCronToUI(next.cronExpr)
    setActiveId(next.id)
    setDraft({ ...next, cronExpr })
  }

  const createNew = () => {
    setActiveId('')
    setDraft(emptyDraft())
    applyCronToUI('')
    setRuns([])
  }

  const applyDraftFromCommand = useCallback(
    async (payload: {
      policyId?: string
      name?: string
      kind?: string
      path?: string
      destRoot?: string
      sshHostId?: string
      connectionId?: string
      beforeWrite?: boolean
      retainDays?: number
      retainCount?: number
      enabled?: boolean
      create?: boolean
    }) => {
      // 先同步落草稿，再刷列表——避免 refresh 慢/失败时表单空白。
      if (payload.create || payload.path || payload.connectionId) {
        const kind =
          payload.kind === 'db' || payload.kind === 'sqlite' || payload.kind === 'files'
            ? payload.kind
            : payload.path?.toLowerCase().endsWith('.db')
              ? 'sqlite'
              : payload.connectionId
                ? 'db'
                : 'files'
        const next: BackupPolicy = {
          ...emptyDraft(),
          name: payload.name || (payload.path ? payload.path.split('/').pop() || 'backup' : '新备份策略'),
          kind,
          path: payload.path || '',
          destRoot: payload.destRoot || emptyDraft().destRoot,
          sshHostId: payload.sshHostId || '',
          connectionId: payload.connectionId || '',
          beforeWrite: payload.beforeWrite ?? true,
          retainDays: payload.retainDays ?? (payload.retainCount != null ? 0 : 7),
          retainCount: payload.retainCount ?? 0,
          enabled: payload.enabled ?? true,
        }
        setActiveId('')
        setDraft(next)
        applyCronToUI('')
        setRuns([])
      }

      const list = await refresh()
      if (payload.policyId) {
        const hit = list.find((i) => i.id === payload.policyId)
        if (hit) {
          selectItem({
            ...hit,
            ...(payload.path ? { path: payload.path } : {}),
            ...(payload.destRoot ? { destRoot: payload.destRoot } : {}),
            ...(payload.sshHostId != null ? { sshHostId: payload.sshHostId } : {}),
          })
        }
      }
    },
    [refresh],
  )

  useWorkbenchCommand(Capability.BackupOpen, (cmd) => {
    const num = (key: string) => {
      const raw = cmd.payload[key]
      if (typeof raw === 'number') return raw
      if (typeof raw === 'string' && raw.trim()) {
        const n = Number(raw)
        return Number.isFinite(n) ? n : undefined
      }
      return undefined
    }
    void applyDraftFromCommand({
      policyId: payloadStr(cmd.payload, 'policyId') || undefined,
      name: payloadStr(cmd.payload, 'name') || undefined,
      kind: payloadStr(cmd.payload, 'kind') || undefined,
      path: payloadStr(cmd.payload, 'path') || undefined,
      destRoot: payloadStr(cmd.payload, 'destRoot') || undefined,
      sshHostId: payloadStr(cmd.payload, 'sshHostId') || undefined,
      connectionId: payloadStr(cmd.payload, 'connectionId') || undefined,
      beforeWrite:
        cmd.payload.beforeWrite === undefined ? undefined : payloadBool(cmd.payload, 'beforeWrite'),
      retainDays: num('retainDays'),
      retainCount: num('retainCount'),
      enabled: cmd.payload.enabled === undefined ? undefined : payloadBool(cmd.payload, 'enabled'),
      create: payloadBool(cmd.payload, 'create'),
    }).catch((err) => setStatusMessage(err instanceof Error ? err.message : String(err)))
  })

  const openSftpPicker = (field: 'path' | 'destRoot') => {
    if (!draft.sshHostId.trim()) {
      setStatusMessage(t('backup.needSSHHost'))
      return
    }
    setPathPicker({
      field,
      mode: field === 'destRoot' ? 'dir' : draft.kind === 'sqlite' ? 'file' : 'any',
    })
  }

  const save = async () => {
    if (draft.cronExpr && !draft.sshHostId.trim()) {
      setStatusMessage(t('backup.cronNeedSSH'))
      return
    }
    if (scheduleOn && (!schedule.weekdays.length || !schedule.hours.length)) {
      setStatusMessage(t('backup.scheduleIncomplete'))
      return
    }
    setBusy(true)
    try {
      const saved = await api.saveBackupPolicy(toDO(draft))
      const withCron = normalizePolicy(saved)
      setStatusMessage(
        withCron.cronExpr && withCron.enabled && scheduleSummary
          ? t('backup.savedWithSchedule', { name: withCron.name, schedule: scheduleSummary })
          : t('backup.saved', { name: withCron.name }),
      )
      const list = await refresh()
      const hit = list.find((i) => i.id === saved.id)
      if (hit) selectItem(hit)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** runNow 手动立即备份：未保存则先落盘，一点即跑不二次确认。 */
  const runNow = async () => {
    if (!draft.name.trim()) {
      setStatusMessage(t('backup.nameRequired'))
      return
    }
    if (draft.kind !== 'db' && !draft.path.startsWith('/')) {
      setStatusMessage(t('backup.pathRequired'))
      return
    }
    if (draft.kind === 'db' && !draft.connectionId) {
      setStatusMessage(t('backup.connectionRequired'))
      return
    }
    setBusy(true)
    try {
      let policyId = draft.id
      let name = draft.name
      if (!policyId) {
        const saved = await api.saveBackupPolicy(toDO(draft))
        const withCron = normalizePolicy(saved)
        policyId = withCron.id
        name = withCron.name
        const list = await refresh()
        const hit = list.find((i) => i.id === policyId)
        if (hit) selectItem(hit)
      }
      setStatusMessage(t('backup.running', { name }))
      await api.runBackupPolicy(policyId, `手动立即备份 · ${name}`, true)
      setStatusMessage(t('backup.runOk'))
      await refreshRuns(policyId)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await api.deleteBackupPolicy(deleteTarget.id)
      setStatusMessage(t('backup.deleted'))
      setDeleteTarget(null)
      createNew()
      await refresh()
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const hostLabel = (id: string) => {
    const h = hosts.find((x) => x.id === id)
    return h ? `${h.name} · ${h.user}@${h.host}` : id || t('backup.localHost')
  }

  return (
    <div className="product-workbench backup-workbench">
      <header className="product-toolbar backup-toolbar">
        <div className="product-title">{t('products.backup.label')}</div>
        <div className="product-actions">
          <button type="button" className="wn-btn wn-btn-tool" disabled={busy} {...pressProps(() => void refresh())}>
            <IconRefresh size={14} />
            {t('common.refresh')}
          </button>
          <button type="button" className="wn-btn wn-btn-tool" disabled={busy} {...pressProps(createNew)}>
            <IconPlus size={14} />
            {t('backup.new')}
          </button>
          <button type="button" className="wn-btn wn-btn-tool" disabled={busy} {...pressProps(() => void save())}>
            <IconSave size={14} />
            {t('common.save')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-tool danger"
            disabled={busy || !draft.id}
            title={draft.id ? t('backup.deleteTitle') : t('backup.deleteNeedSave')}
            {...pressProps(() => {
              if (!draft.id) return
              setDeleteTarget(draft)
            })}
          >
            <IconTrash size={14} />
            {t('common.delete')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-primary wn-btn-sm"
            disabled={busy}
            title={t('backup.runHint')}
            {...pressProps(() => void runNow())}
          >
            <IconPlay size={14} />
            {t('backup.runNow')}
          </button>
        </div>
      </header>

      <div className="product-body">
        <aside className="app-sidebar backup-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('backup.policies')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('backup.new')} {...pressProps(createNew)}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {items.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title={t('backup.empty')}
                  hint={t('backup.emptyHint')}
                  actions={[{ label: t('backup.new'), onPress: createNew, primary: true }]}
                />
              ) : (
                <ul className="conn-list">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`conn-item backup-policy-item ${item.id === activeId ? 'active' : ''}`}
                      {...pressProps(() => selectItem(item))}
                    >
                      <div className="conn-meta">
                        <span className="conn-name">{item.name}</span>
                        <span className="conn-host">
                          {t(KIND_LABEL[item.kind])}
                          {item.retainDays > 0
                            ? ` · ${item.retainDays}d`
                            : item.retainCount > 0
                              ? ` · ×${item.retainCount}`
                              : ''}
                          {item.cronExpr ? ` · ${t('backup.scheduled')}` : ''}
                          {!item.enabled ? ` · ${t('backup.disabled')}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="wn-btn wn-btn-icon wn-btn-sm backup-policy-delete"
                        title={t('backup.deleteTitle')}
                        disabled={busy}
                        {...pressProps(() => setDeleteTarget(item), { stop: true, disabled: busy })}
                      >
                        <IconTrash size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <main className="app-main backup-main">
          <div className="backup-config">
            <div className="backup-row backup-row-2">
              <div className="backup-field">
                <label className="wn-label">{t('backup.name')}</label>
                <input
                  className="wn-input"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder={t('backup.namePlaceholder')}
                />
              </div>
              <div className="backup-field">
                <label className="wn-label">{t('backup.kind')}</label>
                <Select
                  value={draft.kind}
                  options={[
                    { value: 'files', label: t('backup.kindFiles') },
                    { value: 'sqlite', label: t('backup.kindSqlite') },
                    { value: 'db', label: t('backup.kindDb') },
                  ]}
                  onChange={(kind) =>
                    setDraft((d) => ({
                      ...d,
                      kind: kind as BackupPolicy['kind'],
                    }))
                  }
                />
              </div>
            </div>

            {(draft.kind === 'files' || draft.kind === 'sqlite') && (
              <div className="backup-row">
                <label className="wn-label">{t('backup.path')}</label>
                <div className="backup-path-row">
                  <input
                    className="wn-input"
                    value={draft.path}
                    onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
                    placeholder="/www/.../data/wistop.db"
                  />
                  <button
                    type="button"
                    className="wn-btn wn-btn-sm wn-btn-tool"
                    {...pressProps(() => openSftpPicker('path'))}
                  >
                    {t('backup.browsePath')}
                  </button>
                </div>
              </div>
            )}

            {draft.kind === 'db' && (
              <div className="backup-row">
                <label className="wn-label">{t('backup.connection')}</label>
                <Select
                  value={draft.connectionId}
                  options={[
                    { value: '', label: t('backup.pickConnection') },
                    ...connections.map((c) => ({
                      value: c.id,
                      label: `${c.name} · ${c.dbType}/${c.database || c.host}`,
                    })),
                  ]}
                  onChange={(connectionId) => setDraft((d) => ({ ...d, connectionId }))}
                />
              </div>
            )}

            <div className="backup-row">
              <label className="wn-label">{t('backup.sshHost')}</label>
              <Select
                value={draft.sshHostId}
                options={[
                  { value: '', label: t('backup.localHost') },
                  ...hosts.map((h) => ({
                    value: h.id,
                    label: `${h.name} · ${h.user}@${h.host}`,
                  })),
                ]}
                onChange={(sshHostId) => setDraft((d) => ({ ...d, sshHostId }))}
              />
            </div>

            <div className="backup-row">
              <label className="wn-label">{t('backup.destRoot')}</label>
              <div className="backup-path-row">
                <input
                  className="wn-input"
                  value={draft.destRoot}
                  onChange={(e) => setDraft((d) => ({ ...d, destRoot: e.target.value }))}
                />
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool"
                  {...pressProps(() => openSftpPicker('destRoot'))}
                >
                  {t('backup.browsePath')}
                </button>
              </div>
            </div>

            <div className="backup-section">
              <div className="backup-section-title">{t('backup.schedule')}</div>
              <label className="wn-check backup-schedule-toggle">
                <input
                  type="checkbox"
                  checked={scheduleOn}
                  onChange={(e) => {
                    const on = e.target.checked
                    setScheduleOn(on)
                    if (!on) {
                      setDraft((d) => ({ ...d, cronExpr: '' }))
                      return
                    }
                    const next =
                      schedule.weekdays.length && schedule.hours.length ? schedule : defaultSchedule()
                    setSchedule(next)
                    setDraft((d) => ({ ...d, cronExpr: buildBackupCron(next) }))
                  }}
                />
                {t('backup.scheduleEnable')}
              </label>

              {scheduleOn && (
                <>
                  <div className="backup-row">
                    <label className="wn-label">{t('backup.weekdays')}</label>
                    <div className="backup-chip-row">
                      {WEEKDAY_OPTIONS.map((opt) => {
                        const on = schedule.weekdays.includes(opt.value)
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            className={`backup-chip ${on ? 'is-on' : ''}`}
                            {...pressProps(() =>
                              patchSchedule({
                                ...schedule,
                                weekdays: toggleNumber(schedule.weekdays, opt.value),
                              }),
                            )}
                          >
                            {t(opt.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="backup-row">
                    <label className="wn-label">{t('backup.startTimes')}</label>
                    <div className="backup-chip-row">
                      {HOUR_OPTIONS.map((h) => {
                        const on = schedule.hours.includes(h)
                        return (
                          <button
                            key={h}
                            type="button"
                            className={`backup-chip ${on ? 'is-on' : ''}`}
                            {...pressProps(() =>
                              patchSchedule({
                                ...schedule,
                                hours: toggleNumber(schedule.hours, h),
                              }),
                            )}
                          >
                            {formatHourLabel(h)}
                          </button>
                        )
                      })}
                    </div>
                    <p className="backup-cron-hint">{t('backup.startTimesHint')}</p>
                  </div>
                </>
              )}
              <p className="backup-cron-hint">{t('backup.cronHint')}</p>
            </div>

            <div className="backup-section">
              <div className="backup-section-title">{t('backup.retainTime')}</div>
              <div className="backup-retain-options">
                <label className={`backup-retain-card ${retainMode === 'days' ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="backup-retain-mode"
                    checked={retainMode === 'days'}
                    onChange={() =>
                      setDraft((d) => ({
                        ...d,
                        retainDays: d.retainDays > 0 ? d.retainDays : 7,
                        retainCount: 0,
                      }))
                    }
                  />
                  <span className="backup-retain-card-body">
                    <span className="backup-retain-card-title">{t('backup.retainDaysMode')}</span>
                    <span className="backup-retain-inline">
                      <input
                        className="wn-input backup-retain-num"
                        type="number"
                        min={1}
                        max={65535}
                        disabled={retainMode !== 'days'}
                        value={retainMode === 'days' ? draft.retainDays || 7 : 7}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(65535, Math.floor(Number(e.target.value) || 7)))
                          setDraft((d) => ({ ...d, retainDays: n, retainCount: 0 }))
                        }}
                      />
                      <span>{t('backup.daysUnit')}</span>
                      <span className="backup-retain-range">{t('backup.retainDaysRange')}</span>
                    </span>
                  </span>
                </label>

                <label className={`backup-retain-card ${retainMode === 'count' ? 'is-on' : ''}`}>
                  <input
                    type="radio"
                    name="backup-retain-mode"
                    checked={retainMode === 'count'}
                    onChange={() =>
                      setDraft((d) => ({
                        ...d,
                        retainDays: 0,
                        retainCount: d.retainCount > 0 ? d.retainCount : 100,
                      }))
                    }
                  />
                  <span className="backup-retain-card-body">
                    <span className="backup-retain-card-title">{t('backup.retainCountMode')}</span>
                    <span className="backup-retain-inline">
                      <input
                        className="wn-input backup-retain-num"
                        type="number"
                        min={0}
                        max={2000}
                        disabled={retainMode !== 'count'}
                        value={retainMode === 'count' ? draft.retainCount : 100}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(2000, Math.floor(Number(e.target.value) || 0)))
                          setDraft((d) => ({ ...d, retainDays: 0, retainCount: n }))
                        }}
                      />
                      <span>{t('backup.copiesUnit')}</span>
                    </span>
                    <span className="backup-retain-desc">{t('backup.retainCountHint')}</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="backup-row backup-checks">
              <label className="wn-check">
                <input
                  type="checkbox"
                  checked={draft.beforeWrite}
                  onChange={(e) => setDraft((d) => ({ ...d, beforeWrite: e.target.checked }))}
                />
                {t('backup.beforeWrite')}
              </label>
              <label className="wn-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                />
                {t('backup.enabled')}
              </label>
            </div>

            {(active || draft.sshHostId) && (
              <div className="backup-meta">
                <span>{hostLabel(draft.sshHostId || active?.sshHostId || '')}</span>
              </div>
            )}
          </div>

          <aside className="backup-runs">
            <header className="backup-runs-head">
              <span>{t('backup.runs')}</span>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-sm"
                disabled={!draft.id}
                title={t('backup.runsSyncHint')}
                {...pressProps(() => draft.id && void refreshRuns(draft.id))}
              >
                <IconRefresh size={14} />
              </button>
            </header>
            {runs.length === 0 ? (
              <div className="backup-runs-empty">{t('backup.runsEmpty')}</div>
            ) : (
              <div className="backup-runs-table-wrap">
                <table className="backup-runs-table">
                  <thead>
                    <tr>
                      <th>{t('backup.runColTime')}</th>
                      <th>{t('backup.runColStatus')}</th>
                      <th>{t('backup.runColTrigger')}</th>
                      <th>{t('backup.runColDest')}</th>
                      <th>{t('backup.runColIntent')}</th>
                      <th>{t('backup.runColDetail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className={`is-${r.status}`}>
                        <td className="backup-run-cell-time">
                          {new Date(r.createdAt * 1000).toLocaleString()}
                        </td>
                        <td>
                          <span className={`backup-run-status is-${r.status}`}>{r.status}</span>
                        </td>
                        <td className="backup-run-cell-trigger">{r.trigger || '—'}</td>
                        <td className="backup-run-cell-path" title={r.destPath || undefined}>
                          {r.destPath || '—'}
                        </td>
                        <td className="backup-run-cell-intent" title={r.intent || undefined}>
                          {r.intent || '—'}
                        </td>
                        <td className="backup-run-cell-detail" title={r.detail || undefined}>
                          {r.detail || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        </main>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('backup.deleteTitle')}
        message={deleteTarget ? t('backup.deleteMsg', { name: deleteTarget.name }) : undefined}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <SftpPathPicker
        open={Boolean(pathPicker)}
        title={
          pathPicker?.field === 'destRoot' ? t('backup.pickDestTitle') : t('backup.pickPathTitle')
        }
        sshHostId={draft.sshHostId}
        hosts={hosts}
        initialPath={pathPicker?.field === 'destRoot' ? draft.destRoot : draft.path}
        mode={pathPicker?.mode || 'any'}
        onCancel={() => setPathPicker(null)}
        onPick={(path) => {
          const field = pathPicker?.field
          setPathPicker(null)
          if (!field) return
          setDraft((d) => ({ ...d, [field]: path }))
        }}
      />
    </div>
  )
}

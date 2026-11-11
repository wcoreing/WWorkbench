import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { BackupPolicy, BackupRun, Connection, HostHealthReport, SSHHost } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import {
  IconArrowRight,
  IconPlus,
  IconPlay,
  IconRefresh,
  IconSave,
  IconSearch,
  IconServer,
  IconTrash,
} from '../../components/Icons'
import { Select, dismissOverlays, pressProps } from '../../components/compat'
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
import { HostHealthCard } from './HostHealthCard'
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

function hostLabelCompare(hosts: SSHHost[], a: string, b: string) {
  const ha = hosts.find((h) => h.id === a)
  const hb = hosts.find((h) => h.id === b)
  const la = ha ? `${ha.name} ${ha.host}` : a
  const lb = hb ? `${hb.name} ${hb.host}` : b
  return la.localeCompare(lb, 'zh')
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
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [scheduleOn, setScheduleOn] = useState(false)
  const [schedule, setSchedule] = useState<BackupSchedule>(defaultSchedule())
  const [pathPicker, setPathPicker] = useState<{
    field: 'path' | 'destRoot' | 'healthWorkDir'
    mode: SftpPathPickMode
  } | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const [healthHostId, setHealthHostId] = useState('')
  const [healthWorkDir, setHealthWorkDir] = useState('')
  const [healthReport, setHealthReport] = useState<HostHealthReport | null>(null)
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({})

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId])
  const retainMode = retainModeOf(draft)
  const selectedList = useMemo(() => items.filter((p) => selectedIds[p.id]), [items, selectedIds])
  const selectedCount = selectedList.length

  /** 服务器树：全部 SSH 主机 + 本机（若有策略），节点下挂备份策略。 */
  const hostGroups = useMemo(() => {
    const byId = new Map<string, BackupPolicy[]>()
    for (const p of items) {
      const key = p.sshHostId || ''
      const list = byId.get(key)
      if (list) list.push(p)
      else byId.set(key, [p])
    }
    for (const h of hosts) {
      if (!byId.has(h.id)) byId.set(h.id, [])
    }
    const keys = Array.from(byId.keys()).sort((a, b) => {
      if (!a) return 1
      if (!b) return -1
      return hostLabelCompare(hosts, a, b)
    })
    return keys.map((id) => {
      const h = id ? hosts.find((x) => x.id === id) : null
      return {
        id,
        name: h?.name || '',
        meta: h ? `${h.user}@${h.host}` : '',
        policies: byId.get(id) || [],
      }
    })
  }, [items, hosts])

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
    setHealthHostId((prev) => {
      if (prev && hs.some((h) => h.id === prev)) return prev
      return hs.length === 1 ? hs[0].id : prev
    })
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
    const hostKey = next.sshHostId || '__local__'
    setExpandedHosts((prev) => ({ ...prev, [hostKey]: true }))
  }

  const toggleSelected = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      if (!on) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: true }
    })
  }

  const toggleHostSelected = (policyIds: string[], on: boolean) => {
    setSelectedIds((prev) => {
      const next = { ...prev }
      for (const id of policyIds) {
        if (on) next[id] = true
        else delete next[id]
      }
      return next
    })
  }

  const askDelete = (ids: string[]) => {
    if (!ids.length) return
    dismissOverlays()
    setPendingDeleteIds(ids)
  }

  const createNew = () => {
    setActiveId('')
    setDraft(emptyDraft())
    applyCronToUI('')
    setRuns([])
  }

  const scanHealth = async () => {
    if (!healthHostId) {
      setStatusMessage(t('backup.healthNeedHost'))
      return
    }
    const dir = healthWorkDir.trim()
    if (!dir.startsWith('/')) {
      setStatusMessage(t('backup.healthNeedWorkDir'))
      return
    }
    setBusy(true)
    try {
      const report = await api.scanHostHealth(healthHostId, dir)
      setHealthReport({
        ...report,
        findings: Array.isArray(report.findings) ? report.findings : [],
      })
      setStatusMessage(report.summary || t('backup.healthDone'))
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const createSelectedHealthPolicies = async (findingIds: string[], withCron: boolean) => {
    if (!healthHostId || findingIds.length === 0) return
    const dir = (healthReport?.workDir || healthWorkDir).trim()
    if (!dir.startsWith('/')) {
      setStatusMessage(t('backup.healthNeedWorkDir'))
      return
    }
    setBusy(true)
    try {
      const out = await api.ensureHostBackupPolicies(healthHostId, dir, findingIds, withCron)
      setHealthReport({
        ...out.report,
        findings: Array.isArray(out.report?.findings) ? out.report.findings : [],
      })
      await refresh()
      const n = Array.isArray(out.created) ? out.created.length : 0
      setStatusMessage(t('backup.healthCreateOk', { count: String(n) }))
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
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
      if (payload.sshHostId) {
        setHealthHostId(payload.sshHostId)
      }
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

  const confirmDelete = async (ids: string[]) => {
    if (!ids.length) return
    setPendingDeleteIds(null)
    setBusy(true)
    try {
      const out = await api.deleteBackupPolicies(ids)
      const deleted = Number(out?.deleted || 0)
      const note = typeof out?.note === 'string' ? out.note : ''
      setStatusMessage(
        deleted > 1
          ? `${t('backup.batchDeleted', { count: String(deleted) })}${note ? ` · ${note}` : ''}`
          : deleted === 1
            ? t('backup.deleted')
            : t('backup.batchDeleteNone'),
      )
      setSelectedIds((prev) => {
        const next = { ...prev }
        for (const id of ids) delete next[id]
        return next
      })
      if (ids.includes(activeId) || ids.includes(draft.id)) createNew()
      await refresh()
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err))
      await refresh().catch(() => {})
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
          <button
            type="button"
            className="wn-btn wn-btn-tool"
            disabled={busy}
            title={t('backup.healthHint')}
            {...pressProps(() => {
              if (!healthHostId && draft.sshHostId) setHealthHostId(draft.sshHostId)
              setHealthOpen(true)
            })}
          >
            {t('backup.healthOpen')}
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
            disabled={busy || (selectedCount === 0 && !draft.id)}
            title={
              selectedCount > 0
                ? t('backup.batchDeleteTitle')
                : draft.id
                  ? t('backup.deleteTitle')
                  : t('backup.deleteNeedSave')
            }
            {...pressProps(() => {
              if (selectedCount > 0) {
                askDelete(selectedList.map((p) => p.id))
                return
              }
              if (!draft.id) return
              askDelete([draft.id])
            })}
          >
            <IconTrash size={14} />
            {selectedCount > 0 ? `${t('backup.batchDelete')} (${selectedCount})` : t('common.delete')}
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

      <div className="product-body backup-body">
        <aside className="app-sidebar backup-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('backup.serverTree')}</span>
              <div className="backup-sidebar-header-actions">
                {selectedCount > 0 ? (
                  <button
                    type="button"
                    className="wn-btn wn-btn-icon wn-btn-sm"
                    title={t('backup.batchDeleteTitle')}
                    disabled={busy}
                    {...pressProps(() => askDelete(selectedList.map((p) => p.id)))}
                  >
                    <IconTrash size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wn-btn wn-btn-icon wn-btn-sm"
                  title={t('backup.healthOpen')}
                  {...pressProps(() => {
                    if (!healthHostId && draft.sshHostId) setHealthHostId(draft.sshHostId)
                    setHealthOpen(true)
                  })}
                >
                  <IconSearch size={14} />
                </button>
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('backup.new')} {...pressProps(createNew)}>
                  <IconPlus size={14} />
                </button>
              </div>
            </div>
            {selectedCount > 0 ? (
              <div className="backup-selection-bar">
                <span>{t('backup.selectedCount', { count: String(selectedCount) })}</span>
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool"
                  {...pressProps(() => setSelectedIds({}))}
                >
                  {t('backup.clearSelection')}
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool danger"
                  disabled={busy}
                  {...pressProps(() => askDelete(selectedList.map((p) => p.id)))}
                >
                  {t('backup.batchDelete')}
                </button>
              </div>
            ) : null}
            <div className="sidebar-body">
              {hostGroups.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title={t('backup.emptyServers')}
                  hint={t('backup.emptyServersHint')}
                  actions={[
                    { label: t('backup.healthOpen'), onPress: () => setHealthOpen(true) },
                    { label: t('backup.new'), onPress: createNew, primary: true },
                  ]}
                />
              ) : (
                <ul className="backup-server-tree">
                  {hostGroups.map((g) => {
                    const key = g.id || '__local__'
                    const open = expandedHosts[key] === true
                    const title = g.id ? g.name || g.meta || g.id : t('backup.localHost')
                    const subtitle = g.id ? g.meta : t('backup.localHostHint')
                    const hostPolicyIds = g.policies.map((p) => p.id)
                    const hostSelectedCount = hostPolicyIds.filter((id) => selectedIds[id]).length
                    const hostAllSelected =
                      hostPolicyIds.length > 0 && hostSelectedCount === hostPolicyIds.length
                    return (
                      <li key={key} className="backup-server-node">
                        <div
                          className={`backup-server-row ${open ? 'is-open' : ''} ${
                            draft.sshHostId === g.id && !activeId ? 'is-active-host' : ''
                          }`}
                          {...pressProps(() =>
                            setExpandedHosts((prev) => ({ ...prev, [key]: !open })),
                          )}
                        >
                          <span className={`backup-server-caret ${open ? 'is-open' : ''}`}>
                            <IconArrowRight size={10} />
                          </span>
                          <IconServer size={14} />
                          <div className="backup-server-meta">
                            <span className="backup-server-name">{title}</span>
                            {subtitle ? <span className="backup-server-sub">{subtitle}</span> : null}
                          </div>
                          <span className="backup-host-group-count">{g.policies.length}</span>
                          {g.id ? (
                            <button
                              type="button"
                              className="wn-btn wn-btn-icon wn-btn-sm"
                              title={t('backup.healthOpen')}
                              {...pressProps(
                                () => {
                                  setHealthHostId(g.id)
                                  setDraft((d) => ({ ...d, sshHostId: g.id }))
                                  setHealthReport(null)
                                  setHealthOpen(true)
                                },
                                { stop: true },
                              )}
                            >
                              <IconSearch size={14} />
                            </button>
                          ) : null}
                        </div>
                        {open ? (
                          <ul className="backup-server-children">
                            {g.policies.length === 0 ? (
                              <li className="backup-server-empty">{t('backup.noPoliciesUnderHost')}</li>
                            ) : (
                              <>
                                <li className="backup-server-select-all">
                                  <label className="wn-check">
                                    <input
                                      type="checkbox"
                                      checked={hostAllSelected}
                                      onChange={(e) =>
                                        toggleHostSelected(hostPolicyIds, e.target.checked)
                                      }
                                    />
                                    {t('backup.selectAllUnderHost')}
                                    {hostSelectedCount > 0 ? ` (${hostSelectedCount})` : ''}
                                  </label>
                                </li>
                                {g.policies.map((item) => (
                                  <PolicyListItem
                                    key={item.id}
                                    item={item}
                                    active={item.id === activeId}
                                    checked={Boolean(selectedIds[item.id])}
                                    busy={busy}
                                    kindLabel={t(KIND_LABEL[item.kind])}
                                    scheduledLabel={t('backup.scheduled')}
                                    disabledLabel={t('backup.disabled')}
                                    deleteTitle={t('backup.deleteTitle')}
                                    onToggle={(on) => toggleSelected(item.id, on)}
                                    onSelect={() => selectItem(item)}
                                    onDelete={() => askDelete([item.id])}
                                  />
                                ))}
                              </>
                            )}
                          </ul>
                        ) : null}
                      </li>
                    )
                  })}
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

      <HostHealthCard
        open={healthOpen}
        onClose={() => setHealthOpen(false)}
        hosts={hosts}
        hostId={healthHostId}
        onHostIdChange={(id) => {
          setHealthHostId(id)
          setHealthReport(null)
          if (id) setDraft((d) => (d.sshHostId ? d : { ...d, sshHostId: id }))
        }}
        workDir={healthWorkDir}
        onWorkDirChange={(dir) => {
          setHealthWorkDir(dir)
          setHealthReport(null)
        }}
        onBrowseWorkDir={() => {
          if (!healthHostId) {
            setStatusMessage(t('backup.healthNeedHost'))
            return
          }
          setPathPicker({ field: 'healthWorkDir', mode: 'dir' })
        }}
        report={healthReport}
        busy={busy}
        onScan={() => void scanHealth()}
        onCreateSelected={async (ids, withCron) => {
          await createSelectedHealthPolicies(ids, withCron)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteIds?.length)}
        title={
          (pendingDeleteIds?.length || 0) > 1 ? t('backup.batchDeleteTitle') : t('backup.deleteTitle')
        }
        message={
          !pendingDeleteIds?.length
            ? undefined
            : pendingDeleteIds.length > 1
              ? t('backup.batchDeleteMsg', { count: String(pendingDeleteIds.length) })
              : t('backup.deleteMsg', {
                  name: items.find((p) => p.id === pendingDeleteIds[0])?.name || draft.name || '',
                })
        }
        danger
        onConfirm={() => {
          const ids = pendingDeleteIds ? [...pendingDeleteIds] : []
          void confirmDelete(ids)
        }}
        onCancel={() => setPendingDeleteIds(null)}
      />

      <SftpPathPicker
        open={Boolean(pathPicker)}
        title={
          pathPicker?.field === 'destRoot'
            ? t('backup.pickDestTitle')
            : pathPicker?.field === 'healthWorkDir'
              ? t('backup.healthPickWorkDirTitle')
              : t('backup.pickPathTitle')
        }
        sshHostId={pathPicker?.field === 'healthWorkDir' ? healthHostId : draft.sshHostId}
        hosts={hosts}
        initialPath={
          pathPicker?.field === 'destRoot'
            ? draft.destRoot
            : pathPicker?.field === 'healthWorkDir'
              ? healthWorkDir
              : draft.path
        }
        mode={pathPicker?.mode || 'any'}
        onCancel={() => setPathPicker(null)}
        onPick={(path) => {
          const field = pathPicker?.field
          setPathPicker(null)
          if (!field) return
          if (field === 'healthWorkDir') {
            setHealthWorkDir(path)
            setHealthReport(null)
            return
          }
          setDraft((d) => ({ ...d, [field]: path }))
        }}
      />
    </div>
  )
}

function PolicyListItem({
  item,
  active,
  checked,
  busy,
  kindLabel,
  scheduledLabel,
  disabledLabel,
  deleteTitle,
  onToggle,
  onSelect,
  onDelete,
}: {
  item: BackupPolicy
  active: boolean
  checked: boolean
  busy: boolean
  kindLabel: string
  scheduledLabel: string
  disabledLabel: string
  deleteTitle: string
  onToggle: (on: boolean) => void
  onSelect: () => void
  onDelete: () => void
}) {
  const pathHint = item.kind === 'db' ? item.connectionId : item.path || ''
  return (
    <li
      className={`conn-item backup-policy-item ${active ? 'active' : ''} ${checked ? 'is-checked' : ''}`}
      {...pressProps(onSelect)}
    >
      <label
        className="wn-check backup-policy-check"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
      </label>
      <div className="conn-meta">
        <span className="conn-name">{item.name}</span>
        <span className="conn-host" title={pathHint || undefined}>
          {kindLabel}
          {pathHint ? ` · ${pathHint}` : ''}
          {item.cronExpr ? ` · ${scheduledLabel}` : ''}
          {!item.enabled ? ` · ${disabledLabel}` : ''}
        </span>
      </div>
      <button
        type="button"
        className="wn-btn wn-btn-icon wn-btn-sm backup-policy-delete"
        title={deleteTitle}
        disabled={busy}
        {...pressProps(onDelete, { stop: true, disabled: busy })}
      >
        <IconTrash size={13} />
      </button>
    </li>
  )
}

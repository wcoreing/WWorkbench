import { useEffect, useState } from 'react'
import type { CloudAccount, ECSInstance, SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { translate, useI18n } from '../../i18n'
import type { AppLocale } from '../../i18n/types'
import { useLoading, withLoading } from '../../stores/loadingStore'
import { useSSHTrustConfirm } from './useSSHTrustConfirm'
import '../../components/ui.css'
import { backdropDismissProps, pressProps, Select } from '../../components/compat'

interface Props {
  open: boolean
  initial?: SSHHost | null
  onClose: () => void
  onSaved: () => void
}

const emptyHost = (): SSHHost => ({
  id: '',
  name: '',
  host: '',
  port: 22,
  user: 'root',
  password: '',
  keyPath: '',
  hasPassword: false,
  clearPassword: false,
  cloudAccountId: '',
  cloudRegion: '',
  cloudInstanceId: '',
  touchCloud: true,
  createdAt: 0,
  updatedAt: 0,
})

/** 阿里云 ECS 常用地域。已保存但不在表里的地域会临时补进选项。 */
const ECS_REGIONS: { value: string; label: string }[] = [
  { value: 'cn-hangzhou', label: '华东1 杭州' },
  { value: 'cn-shanghai', label: '华东2 上海' },
  { value: 'cn-nanjing', label: '华东5 南京' },
  { value: 'cn-beijing', label: '华北2 北京' },
  { value: 'cn-qingdao', label: '华北1 青岛' },
  { value: 'cn-zhangjiakou', label: '华北3 张家口' },
  { value: 'cn-huhehaote', label: '华北5 呼和浩特' },
  { value: 'cn-wulanchabu', label: '华北6 乌兰察布' },
  { value: 'cn-shenzhen', label: '华南1 深圳' },
  { value: 'cn-guangzhou', label: '华南3 广州' },
  { value: 'cn-chengdu', label: '西南1 成都' },
  { value: 'cn-hongkong', label: '中国香港' },
  { value: 'ap-southeast-1', label: '新加坡' },
  { value: 'us-west-1', label: '美国硅谷' },
  { value: 'us-east-1', label: '美国弗吉尼亚' },
  { value: 'eu-central-1', label: '德国法兰克福' },
]

const emptyAk = () => ({ name: '', accessKeyId: '', accessKeySecret: '' })

/** ecsStatusText 把阿里云实例状态翻成界面文案。 */
function ecsStatusText(status: string, label: (key: string) => string): string {
  const key = (
    {
      Running: 'ecs.statusRunning',
      Stopped: 'ecs.statusStopped',
      Starting: 'ecs.statusStarting',
      Stopping: 'ecs.statusStopping',
    } as Record<string, string>
  )[status]
  return key ? label(key) : status
}

/** ecsInstanceLabel 实例下拉的一行：名称、IP、状态。 */
function ecsInstanceLabel(item: ECSInstance, label: (key: string) => string): string {
  const parts = [item.name || item.instanceId]
  const ip = item.publicIp || item.privateIp
  if (ip) parts.push(ip)
  if (item.status) parts.push(ecsStatusText(item.status, label))
  return parts.join(' · ')
}

/** validateSSHHostForm 校验 SSH 主机表单。 */
function validateSSHHostForm(form: SSHHost, locale: AppLocale): string | null {
  const t = (key: string) => translate(locale, key)
  if (!form.name.trim()) return t('sshHost.errName')
  if (!form.host.trim()) return t('sshHost.errHost')
  if (!form.user.trim()) return t('sshHost.errUser')
  if (!form.port || form.port <= 0) return t('sshHost.errPort')
  const hasAuth =
    form.keyPath.trim() ||
    form.password ||
    (Boolean(form.id) && form.hasPassword && !form.clearPassword)
  if (!hasAuth) {
    return t('sshHost.errAuth')
  }
  return null
}

/** SSH 主机配置弹窗 */
export function SSHHostModal({ open, initial, onClose, onSaved }: Props) {
  const { t, locale } = useI18n()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [form, setForm] = useState<SSHHost>(emptyHost())
  const [accounts, setAccounts] = useState<CloudAccount[]>([])
  const [cloudMode, setCloudMode] = useState('')
  const [newAk, setNewAk] = useState(emptyAk())
  const [instances, setInstances] = useState<ECSInstance[]>([])
  const [instanceLoading, setInstanceLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const testLoading = useLoading('sshHost.test')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setSuccess('')
    setNewAk(emptyAk())
    api.listCloudAccounts().then(setAccounts).catch(() => setAccounts([]))
    if (!initial?.id) {
      setForm(emptyHost())
      setCloudMode('')
      return
    }
    let cancelled = false
    // 列表项不含密码；详情也不回传明文，只带 hasPassword
    setForm({ ...initial, password: '', clearPassword: false, touchCloud: true })
    setCloudMode(initial.cloudAccountId || '')
    api
      .getSSHHost(initial.id)
      .then((host) => {
        if (!cancelled) {
          setForm({
            ...host,
            password: '',
            clearPassword: false,
            hasPassword: Boolean(host.hasPassword),
            cloudAccountId: host.cloudAccountId || '',
            cloudRegion: host.cloudRegion || '',
            cloudInstanceId: host.cloudInstanceId || '',
            touchCloud: true,
          })
          setCloudMode(host.cloudAccountId || '')
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [open, initial?.id])

  useEffect(() => {
    if (!open || !cloudMode || cloudMode === 'new') {
      setInstances([])
      return
    }
    const region = (form.cloudRegion || '').trim()
    if (!region) {
      setInstances([])
      return
    }
    let cancelled = false
    setInstanceLoading(true)
    api
      .listECSInstances(cloudMode, region)
      .then((list) => {
        if (cancelled) return
        setInstances(list)
        setForm((current) => {
          if ((current.cloudInstanceId || '').trim()) return current
          const host = current.host.trim()
          const hit = list.find((item) => item.publicIp === host || item.privateIp === host)
          if (!hit) return current
          return { ...current, cloudInstanceId: hit.instanceId }
        })
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setInstances([])
          setError(e.message)
        }
      })
      .finally(() => {
        if (!cancelled) setInstanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, cloudMode, form.cloudRegion])

  if (!open) return null

  const regionOptions =
    form.cloudRegion && !ECS_REGIONS.some((r) => r.value === form.cloudRegion)
      ? [{ value: form.cloudRegion, label: form.cloudRegion }, ...ECS_REGIONS]
      : ECS_REGIONS

  const pullNewAccount = async () => {
    if (!newAk.name.trim() || !newAk.accessKeyId.trim() || !newAk.accessKeySecret.trim()) {
      setError(t('sshHost.ecsErrAccount'))
      return
    }
    if (!(form.cloudRegion || '').trim()) {
      setError(t('sshHost.ecsErrBind'))
      return
    }
    setInstanceLoading(true)
    setError('')
    try {
      const saved = await api.saveCloudAccount({
        id: '',
        name: newAk.name.trim(),
        provider: 'aliyun',
        accessKeyId: newAk.accessKeyId.trim(),
        accessKeySecret: newAk.accessKeySecret.trim(),
        createdAt: 0,
        updatedAt: 0,
      })
      setAccounts((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)])
      setNewAk(emptyAk())
      setCloudMode(saved.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setInstanceLoading(false)
    }
  }

  const instanceOptions = [
    ...((form.cloudInstanceId || '').trim() &&
    !instances.some((item) => item.instanceId === form.cloudInstanceId)
      ? [{ value: form.cloudInstanceId || '', label: form.cloudInstanceId || '' }]
      : []),
    ...instances.map((item) => ({
      value: item.instanceId,
      label: ecsInstanceLabel(item, t),
    })),
  ]

  const update = (patch: Partial<SSHHost>) => {
    setSuccess('')
    setError('')
    setForm((f) => ({ ...f, ...patch }))
  }

  const handleTest = async () => {
    const invalid = validateSSHHostForm(form, locale)
    if (invalid) {
      setError(invalid)
      return
    }
    await withLoading(
      'sshHost.test',
      async () => {
        setError('')
        setSuccess('')
        try {
          await withSSHHostTrust(form.host, form.port, () => api.testSSHHost(form), confirmTrust)
          setSuccess(t('sshHost.testOk'))
        } catch (e) {
          setError((e as Error).message)
        }
      },
      { label: t('common.testing') },
    )
  }

  const handleSave = async () => {
    const invalid = validateSSHHostForm(form, locale)
    if (invalid) {
      setError(invalid)
      return
    }
    const payload = { ...form, touchCloud: true }
    if (cloudMode === 'new') {
      if (!newAk.name.trim() || !newAk.accessKeyId.trim() || !newAk.accessKeySecret.trim()) {
        setError(t('sshHost.ecsErrAccount'))
        return
      }
      if (!(form.cloudRegion || '').trim() || !form.cloudInstanceId?.trim()) {
        setError(t('sshHost.ecsErrBind'))
        return
      }
    } else if (cloudMode) {
      if (!(form.cloudRegion || '').trim() || !form.cloudInstanceId?.trim()) {
        setError(t('sshHost.ecsErrBind'))
        return
      }
    }
    // 新建交给后端分配 id；前端预生成会导致 mergeSecrets 误查「主机不存在」
    if (!initial?.id) payload.id = ''
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      let cloudAccountId = ''
      if (cloudMode === 'new') {
        const saved = await api.saveCloudAccount({
          id: '',
          name: newAk.name.trim(),
          provider: 'aliyun',
          accessKeyId: newAk.accessKeyId.trim(),
          accessKeySecret: newAk.accessKeySecret.trim(),
          createdAt: 0,
          updatedAt: 0,
        })
        cloudAccountId = saved.id
      } else if (cloudMode) {
        cloudAccountId = cloudMode
      }
      payload.cloudAccountId = cloudAccountId
      payload.cloudRegion = cloudAccountId ? (form.cloudRegion || '').trim() : ''
      payload.cloudInstanceId = cloudAccountId ? (form.cloudInstanceId || '').trim() : ''
      await api.saveSSHHost(payload)
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const isEdit = Boolean(form.id && initial?.id)
  const busy = testLoading.active || saving
  const passwordPlaceholder =
    isEdit && form.hasPassword && !form.clearPassword && !form.password
      ? t('sshHost.passwordKeptPlaceholder')
      : t('sshHost.passwordPlaceholder')

  return (
    <>
      <div className="wn-modal-backdrop" {...backdropDismissProps(onClose)}>
      <div
        className="wn-modal wn-modal-compact"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="ssh-host-modal-title"
      >
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="ssh-host-modal-title" className="wn-modal-title">
              {isEdit ? t('sshHost.editTitle') : t('sshHost.newTitle')}
            </h2>
            <span className="wn-modal-tag">SSH</span>
          </div>
          <p className="wn-modal-desc">{t('sshHost.desc')}</p>
        </header>

        <div className="wn-modal-body">
          <div className="wn-form">
            <div className="wn-field">
              <label className="wn-label" htmlFor="ssh-host-name">
                {t('sshHost.name')}
              </label>
              <input
                id="ssh-host-name"
                className="wn-input"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={t('sshHost.namePlaceholder')}
                autoFocus
              />
            </div>

            <div className="wn-form-row">
              <div className="wn-field">
                <label className="wn-label" htmlFor="ssh-host-addr">
                  {t('sshHost.host')}
                </label>
                <input
                  id="ssh-host-addr"
                  className="wn-input"
                  value={form.host}
                  onChange={(e) => update({ host: e.target.value })}
                  placeholder={t('sshHost.hostPlaceholder')}
                />
              </div>
              <div className="wn-field wn-field-narrow">
                <label className="wn-label" htmlFor="ssh-host-port">
                  {t('sshHost.port')}
                </label>
                <input
                  id="ssh-host-port"
                  className="wn-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => update({ port: Number(e.target.value) || 22 })}
                />
              </div>
            </div>

            <div className="wn-field">
              <label className="wn-label" htmlFor="ssh-host-user">
                {t('sshHost.user')}
              </label>
              <input
                id="ssh-host-user"
                className="wn-input"
                value={form.user}
                onChange={(e) => update({ user: e.target.value })}
              />
            </div>

            <div className="conn-ssh-block">
              <div className="conn-ssh-fields">
                <div className="wn-field">
                  <label className="wn-label" htmlFor="ssh-host-key">
                    {t('sshHost.keyPath')}
                  </label>
                  <input
                    id="ssh-host-key"
                    className="wn-input"
                    value={form.keyPath}
                    onChange={(e) => update({ keyPath: e.target.value })}
                    placeholder={t('sshHost.keyPathPlaceholder')}
                  />
                </div>
                <div className="wn-field">
                  <label className="wn-label" htmlFor="ssh-host-pass">
                    {t('sshHost.password')}
                  </label>
                  <input
                    id="ssh-host-pass"
                    className="wn-input"
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      update({
                        password: e.target.value,
                        clearPassword: false,
                      })
                    }
                    placeholder={passwordPlaceholder}
                    autoComplete="new-password"
                  />
                  {isEdit && form.hasPassword && !form.clearPassword && (
                    <button
                      type="button"
                      className="wn-btn wn-btn-tool"
                      style={{ marginTop: 6 }}
                      {...pressProps(() =>
                        update({ password: '', clearPassword: true, hasPassword: false }),
                      )}
                    >
                      {t('sshHost.clearSavedPassword')}
                    </button>
                  )}
                  {form.clearPassword && (
                    <p className="conn-ssh-hint">{t('sshHost.passwordWillClear')}</p>
                  )}
                </div>
                <p className="conn-ssh-hint">{t('sshHost.hint')}</p>
              </div>
            </div>

            <div className="conn-ssh-block">
              <p className="wn-label">{t('sshHost.ecsTitle')}</p>
              <p className="conn-ssh-hint">{t('sshHost.ecsHint')}</p>
              <div className="wn-field">
                <label className="wn-label" htmlFor="ssh-host-ecs-account">
                  {t('sshHost.ecsAccount')}
                </label>
                <Select
                  id="ssh-host-ecs-account"
                  value={cloudMode}
                  options={[
                    { value: '', label: t('sshHost.ecsOff') },
                    ...accounts.map((a) => ({ value: a.id, label: a.name || a.accessKeyId })),
                    { value: 'new', label: t('sshHost.ecsNew') },
                  ]}
                  onChange={setCloudMode}
                />
              </div>
              {cloudMode === 'new' && (
                <>
                  <div className="wn-field">
                    <label className="wn-label" htmlFor="ssh-host-ecs-name">
                      {t('sshHost.ecsAccountName')}
                    </label>
                    <input
                      id="ssh-host-ecs-name"
                      className="wn-input"
                      value={newAk.name}
                      onChange={(e) => setNewAk((v) => ({ ...v, name: e.target.value }))}
                      placeholder={t('sshHost.ecsAccountNamePlaceholder')}
                    />
                  </div>
                  <div className="wn-field">
                    <label className="wn-label" htmlFor="ssh-host-ecs-ak">
                      {t('sshHost.ecsAccessKeyId')}
                    </label>
                    <input
                      id="ssh-host-ecs-ak"
                      className="wn-input"
                      value={newAk.accessKeyId}
                      onChange={(e) => setNewAk((v) => ({ ...v, accessKeyId: e.target.value }))}
                      autoComplete="off"
                    />
                  </div>
                  <div className="wn-field">
                    <label className="wn-label" htmlFor="ssh-host-ecs-sk">
                      {t('sshHost.ecsAccessKeySecret')}
                    </label>
                    <input
                      id="ssh-host-ecs-sk"
                      className="wn-input"
                      type="password"
                      value={newAk.accessKeySecret}
                      onChange={(e) => setNewAk((v) => ({ ...v, accessKeySecret: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}
              {cloudMode && (
                <div className="wn-form-row">
                  <div className="wn-field">
                    <label className="wn-label" htmlFor="ssh-host-ecs-region">
                      {t('sshHost.ecsRegion')}
                    </label>
                    <Select
                      id="ssh-host-ecs-region"
                      value={form.cloudRegion || ''}
                      placeholder={t('sshHost.ecsRegion')}
                      options={regionOptions}
                      onChange={(cloudRegion) => {
                        if (cloudRegion === (form.cloudRegion || '')) return
                        update({ cloudRegion, cloudInstanceId: '' })
                      }}
                    />
                  </div>
                  {cloudMode === 'new' ? (
                    <div className="wn-field">
                      <label className="wn-label">&nbsp;</label>
                      <button
                        type="button"
                        className="wn-btn wn-btn-tool"
                        {...pressProps(pullNewAccount, { disabled: instanceLoading })}
                        disabled={instanceLoading}
                      >
                        {instanceLoading ? t('sshHost.ecsPulling') : t('sshHost.ecsPull')}
                      </button>
                    </div>
                  ) : (
                    <div className="wn-field">
                      <label className="wn-label" htmlFor="ssh-host-ecs-instance">
                        {t('sshHost.ecsInstanceId')}
                      </label>
                      <Select
                        id="ssh-host-ecs-instance"
                        value={form.cloudInstanceId || ''}
                        placeholder={instanceLoading ? t('sshHost.ecsLoading') : t('sshHost.ecsPick')}
                        options={instanceOptions}
                        disabled={instanceLoading || instanceOptions.length === 0}
                        onChange={(cloudInstanceId) => update({ cloudInstanceId })}
                      />
                      {!instanceLoading && form.cloudRegion && instances.length === 0 && (
                        <p className="conn-ssh-hint">{t('sshHost.ecsEmpty')}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && <div className="wn-form-msg error">{error}</div>}
          {success && <div className="wn-form-msg success">{success}</div>}
        </div>

        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" {...pressProps(onClose, { disabled: busy })} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="wn-btn wn-btn-tool" {...pressProps(handleTest, { disabled: busy })} disabled={busy}>
            {testLoading.active ? t('common.testing') : t('common.testConnection')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            {...pressProps(handleSave, { disabled: busy })}
            disabled={busy}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </footer>
      </div>
    </div>
      {trustDialog}
    </>
  )
}

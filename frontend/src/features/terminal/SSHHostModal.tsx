import { useEffect, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { translate, useI18n } from '../../i18n'
import type { AppLocale } from '../../i18n/types'
import { useLoading, withLoading } from '../../stores/loadingStore'
import { useSSHTrustConfirm } from './useSSHTrustConfirm'
import '../../components/ui.css'
import { pressProps } from '../../components/compat'

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
  createdAt: 0,
  updatedAt: 0,
})

/** validateSSHHostForm 校验 SSH 主机表单。 */
function validateSSHHostForm(form: SSHHost, locale: AppLocale): string | null {
  const t = (key: string) => translate(locale, key)
  if (!form.name.trim()) return t('sshHost.errName')
  if (!form.host.trim()) return t('sshHost.errHost')
  if (!form.user.trim()) return t('sshHost.errUser')
  if (!form.port || form.port <= 0) return t('sshHost.errPort')
  if (!form.keyPath.trim() && !form.password && !form.id) {
    return t('sshHost.errAuth')
  }
  return null
}

/** SSH 主机配置弹窗 */
export function SSHHostModal({ open, initial, onClose, onSaved }: Props) {
  const { t, locale } = useI18n()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [form, setForm] = useState<SSHHost>(emptyHost())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const testLoading = useLoading('sshHost.test')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setSuccess('')
    if (!initial?.id) {
      setForm(emptyHost())
      return
    }
    let cancelled = false
    setForm({ ...initial, password: '' })
    api
      .getSSHHost(initial.id)
      .then((host) => {
        if (!cancelled) setForm(host)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [open, initial?.id])

  if (!open) return null

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
    const payload = { ...form }
    if (!payload.id) payload.id = crypto.randomUUID()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
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

  return (
    <>
      <div className="wn-modal-backdrop" {...pressProps(onClose)}>
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
                    onChange={(e) => update({ password: e.target.value })}
                    placeholder={t('sshHost.passwordPlaceholder')}
                  />
                </div>
                <p className="conn-ssh-hint">{t('sshHost.hint')}</p>
              </div>
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

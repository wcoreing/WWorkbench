import { useEffect, useState } from 'react'
import type { SSHForwardPreset, SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'
import { useI18n } from '../../i18n'
import { ModalPortal, Select, pressProps } from '../../components/compat'
import '../../components/ui.css'

interface Props {
  open: boolean
  hosts: SSHHost[]
  initial?: SSHForwardPreset | null
  defaultHostId?: string
  onClose: () => void
  onSaved: () => void
}

/** SSHForwardModal 新建/编辑端口转发预设。 */
export function SSHForwardModal({ open, hosts, initial, defaultHostId, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [sshHostId, setSSHHostId] = useState('')
  const [localPort, setLocalPort] = useState(0)
  const [remoteHost, setRemoteHost] = useState('127.0.0.1')
  const [remotePort, setRemotePort] = useState(3306)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    if (initial) {
      setName(initial.name)
      setSSHHostId(initial.sshHostId)
      setLocalPort(initial.localPort)
      setRemoteHost(initial.remoteHost)
      setRemotePort(initial.remotePort)
    } else {
      setName('')
      setSSHHostId(defaultHostId || hosts[0]?.id || '')
      setLocalPort(0)
      setRemoteHost('127.0.0.1')
      setRemotePort(3306)
    }
  }, [open, initial, hosts, defaultHostId])

  if (!open) return null

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await api.saveSSHForwardPreset(
        model.SSHForwardPresetDO.createFrom({
          id: initial?.id ?? '',
          name: name.trim(),
          sshHostId,
          localPort: localPort || 0,
          remoteHost: remoteHost.trim(),
          remotePort,
          createdAt: initial?.createdAt ?? 0,
          updatedAt: initial?.updatedAt ?? 0,
        }),
      )
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop" {...pressProps(onClose)}>
        <div
          className="wn-modal wn-modal-compact"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          role="dialog"
        >
          <header className="wn-modal-header">
            <h2 className="wn-modal-title">{initial ? t('sshForward.editPreset') : t('sshForward.newPreset')}</h2>
          </header>
          <div className="wn-modal-body">
            <div className="wn-form">
              <div className="wn-field">
                <label className="wn-label">{t('sshForward.name')}</label>
                <input
                  className="wn-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('sshForward.namePlaceholder')}
                  autoFocus
                />
              </div>
              <div className="wn-field">
                <label className="wn-label">{t('sshForward.sshHost')}</label>
                <Select
                  value={sshHostId}
                  placeholder={t('sshForward.pickHost')}
                  options={hosts.map((h) => ({ value: h.id, label: h.name }))}
                  onChange={setSSHHostId}
                />
              </div>
              <div className="wn-form-row">
                <div className="wn-field">
                  <label className="wn-label">{t('sshForward.localPort')}</label>
                  <input
                    className="wn-input"
                    type="number"
                    min={0}
                    max={65535}
                    value={localPort || ''}
                    placeholder="0"
                    onChange={(e) => setLocalPort(Number(e.target.value) || 0)}
                  />
                  <span className="wn-field-hint">{t('sshForward.localPortHint')}</span>
                </div>
                <div className="wn-field">
                  <label className="wn-label">{t('sshForward.remotePort')}</label>
                  <input
                    className="wn-input"
                    type="number"
                    min={1}
                    max={65535}
                    value={remotePort}
                    onChange={(e) => setRemotePort(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="wn-field">
                <label className="wn-label">{t('sshForward.remoteHost')}</label>
                <input
                  className="wn-input"
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                  placeholder={t('sshForward.remoteHostPlaceholder')}
                />
              </div>
            </div>
            {error && <div className="wn-form-msg error">{error}</div>}
          </div>
          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-tool" disabled={saving} {...pressProps(onClose, { disabled: saving })}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-primary"
              disabled={saving}
              {...pressProps(() => void submit(), { disabled: saving })}
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

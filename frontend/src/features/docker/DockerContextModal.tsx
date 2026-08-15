import { useEffect, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import '../../components/ui.css'
import { Select, pressProps } from '../../components/compat'

interface DockerContextModalProps {
  open: boolean
  hosts: SSHHost[]
  initialHostId?: string
  onClose: () => void
  onSaved: () => void
}

/** DockerContextModal 添加 SSH 远程 Docker 上下文。 */
export function DockerContextModal({ open, hosts, initialHostId, onClose, onSaved }: DockerContextModalProps) {
  const { t } = useI18n()
  const [hostId, setHostId] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    const preferred = initialHostId ? hosts.find((h) => h.id === initialHostId) : undefined
    const pick = preferred ?? hosts[0]
    setHostId(pick?.id ?? '')
    setName(pick ? `SSH · ${pick.name}` : '')
  }, [open, hosts, initialHostId])

  useEffect(() => {
    const host = hosts.find((h) => h.id === hostId)
    if (host && (!name || name.startsWith('SSH · '))) {
      setName(`SSH · ${host.name}`)
    }
  }, [hostId, hosts, name])

  if (!open) return null

  const submit = async () => {
    if (!hostId) {
      setError(t('docker.contextModal.pickHost'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = new model.DockerContextDO({
        id: crypto.randomUUID(),
        name: name.trim() || t('docker.contextModal.namePlaceholder'),
        kind: 'ssh',
        sshHostId: hostId,
      })
      await api.saveDockerContext(payload)
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wn-modal-backdrop" {...pressProps(onClose)}>
      <div
        className="wn-modal wn-modal-compact"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="docker-context-modal-title"
      >
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="docker-context-modal-title" className="wn-modal-title">
              {t('docker.contextModal.title')}
            </h2>
            <span className="wn-modal-tag">Docker</span>
          </div>
          <p className="wn-modal-desc">{t('docker.contextModal.desc')}</p>
        </header>

        <div className="wn-modal-body">
          {hosts.length === 0 ? (
            <p className="conn-ssh-hint">{t('docker.contextModal.noHosts')}</p>
          ) : (
            <div className="wn-form">
              <div className="wn-field">
                <label className="wn-label" htmlFor="docker-ctx-host">
                  {t('docker.contextModal.sshHost')}
                </label>
                <Select
                  id="docker-ctx-host"
                  value={hostId}
                  options={hosts.map((h) => ({
                    value: h.id,
                    label: `${h.name} (${h.user}@${h.host})`,
                  }))}
                  onChange={setHostId}
                />
              </div>
              <div className="wn-field">
                <label className="wn-label" htmlFor="docker-ctx-name">
                  {t('docker.contextModal.displayName')}
                </label>
                <input
                  id="docker-ctx-name"
                  className="wn-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('docker.contextModal.namePlaceholder')}
                />
              </div>
            </div>
          )}
          {error && <div className="wn-form-msg error">{error}</div>}
        </div>

        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" {...pressProps(onClose, { disabled: saving })} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-primary"
            {...pressProps(() => void submit(), { disabled: saving || hosts.length === 0 })}
            disabled={saving || hosts.length === 0}
          >
            {saving ? t('docker.contextModal.saving') : t('common.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}

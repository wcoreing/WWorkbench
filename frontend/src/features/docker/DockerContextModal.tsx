import { useCallback, useEffect, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { shellHostAsSSH } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import { SSHHostModal } from '../terminal/SSHHostModal'
import '../../components/ui.css'
import { Select, pressProps } from '../../components/compat'

interface DockerContextModalProps {
  open: boolean
  initialHostId?: string
  onClose: () => void
  onSaved: () => void
}

/** toSSHHostList 从统一 Shell 主机抽出 SSH 主机。 */
function toSSHHostList(raw: Awaited<ReturnType<typeof api.listShellHosts>>): SSHHost[] {
  return raw.map((h) => shellHostAsSSH(h)).filter((h): h is SSHHost => Boolean(h))
}

/** DockerContextModal 添加 SSH 远程 Docker 上下文。 */
export function DockerContextModal({ open, initialHostId, onClose, onSaved }: DockerContextModalProps) {
  const { t } = useI18n()
  const [hosts, setHosts] = useState<SSHHost[]>([])
  const [hostId, setHostId] = useState('')
  const [name, setName] = useState('')
  const [loadingHosts, setLoadingHosts] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [hostModalOpen, setHostModalOpen] = useState(false)

  const applyHosts = useCallback(
    (list: SSHHost[], preferId?: string) => {
      setHosts(list)
      const preferred = preferId ? list.find((h) => h.id === preferId) : undefined
      const pick = preferred ?? list[0]
      setHostId(pick?.id ?? '')
      setName((prev) => {
        if (pick && (!prev || prev.startsWith('SSH · '))) return `SSH · ${pick.name}`
        return pick ? prev : ''
      })
    },
    [],
  )

  const loadHosts = useCallback(
    async (preferId?: string) => {
      setLoadingHosts(true)
      try {
        const list = toSSHHostList(await api.listShellHosts())
        applyHosts(list, preferId)
        return list
      } catch (e) {
        setHosts([])
        setHostId('')
        setError((e as Error).message)
        return []
      } finally {
        setLoadingHosts(false)
      }
    },
    [applyHosts],
  )

  useEffect(() => {
    if (!open) {
      setHostModalOpen(false)
      return
    }
    setError('')
    void loadHosts(initialHostId)
  }, [open, initialHostId, loadHosts])

  useEffect(() => {
    const host = hosts.find((h) => h.id === hostId)
    if (!host) return
    setName((prev) => (!prev || prev.startsWith('SSH · ') ? `SSH · ${host.name}` : prev))
  }, [hostId, hosts])

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

  const empty = !loadingHosts && hosts.length === 0

  return (
    <>
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
            {loadingHosts ? (
              <p className="conn-ssh-hint">{t('docker.contextModal.loadingHosts')}</p>
            ) : empty ? (
              <div className="wn-form">
                <p className="conn-ssh-hint">{t('docker.contextModal.noHosts')}</p>
                <button
                  type="button"
                  className="wn-btn wn-btn-primary wn-btn-sm"
                  {...pressProps(() => setHostModalOpen(true))}
                >
                  {t('docker.contextModal.addHost')}
                </button>
              </div>
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
            {!empty && (
              <button
                type="button"
                className="wn-btn wn-btn-tool"
                {...pressProps(() => setHostModalOpen(true), { disabled: saving })}
                disabled={saving}
              >
                {t('docker.contextModal.addHost')}
              </button>
            )}
            <button
              type="button"
              className="wn-btn wn-btn-primary"
              {...pressProps(() => void submit(), { disabled: saving || empty || loadingHosts })}
              disabled={saving || empty || loadingHosts}
            >
              {saving ? t('docker.contextModal.saving') : t('common.save')}
            </button>
          </footer>
        </div>
      </div>
      <SSHHostModal
        open={hostModalOpen}
        onClose={() => setHostModalOpen(false)}
        onSaved={() => {
          setHostModalOpen(false)
          void loadHosts()
        }}
      />
    </>
  )
}

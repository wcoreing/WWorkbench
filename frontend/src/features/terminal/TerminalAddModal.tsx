import { useEffect, useState } from 'react'
import type { DockerContainer, DockerContext, ShellHost, SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { ModalPortal, Select, backdropDismissProps, pressProps } from '../../components/compat'
import '../../components/ui.css'

export type TerminalAddKind = 'local' | 'ssh' | 'docker'

type Props = {
  open: boolean
  initialKind?: TerminalAddKind
  onClose: () => void
  onLocal: (workDir?: string) => void
  onSSHSaved: () => void
  onDockerAdded: (host: ShellHost) => void
}

const KINDS: { id: TerminalAddKind; labelKey: string }[] = [
  { id: 'local', labelKey: 'terminal.sideTabLocal' },
  { id: 'ssh', labelKey: 'terminal.sideTabSSH' },
  { id: 'docker', labelKey: 'terminal.sideTabDocker' },
]

const emptySSH = (): SSHHost => ({
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
  sgSync: false,
  sgId: '',
  createdAt: 0,
  updatedAt: 0,
})

/** 终端统一新增弹窗：本机 / SSH / 容器同窗切换（隧道在数据库连接里配置）。 */
export function TerminalAddModal({
  open,
  initialKind = 'ssh',
  onClose,
  onLocal,
  onSSHSaved,
  onDockerAdded,
}: Props) {
  const { t } = useI18n()
  const [kind, setKind] = useState<TerminalAddKind>(initialKind)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [workDir, setWorkDir] = useState('')

  const [ssh, setSSH] = useState<SSHHost>(emptySSH)

  const [contexts, setContexts] = useState<DockerContext[]>([])
  const [contextId, setContextId] = useState('')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [containerId, setContainerId] = useState('')
  const [loadingCtx, setLoadingCtx] = useState(false)
  const [loadingList, setLoadingList] = useState(false)

  useEffect(() => {
    if (!open) return
    const next: TerminalAddKind =
      initialKind === 'local' || initialKind === 'docker' || initialKind === 'ssh' ? initialKind : 'ssh'
    setKind(next)
    setError('')
    setSaving(false)
    setWorkDir('')
    setSSH(emptySSH())
    setContextId('')
    setContainerId('')
    setContainers([])
  }, [open, initialKind])

  useEffect(() => {
    if (!open || kind !== 'docker') return
    setLoadingCtx(true)
    setError('')
    void api
      .listDockerContexts()
      .then((list) => {
        const rows = list as DockerContext[]
        setContexts(rows)
        setContextId((prev) => prev || rows[0]?.id || '')
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingCtx(false))
  }, [open, kind])

  useEffect(() => {
    if (!open || kind !== 'docker' || !contextId) {
      if (kind === 'docker') {
        setContainers([])
        setContainerId('')
      }
      return
    }
    let cancelled = false
    setLoadingList(true)
    setError('')
    setContainerId('')
    void api
      .listContainers(contextId)
      .then((list) => {
        if (cancelled) return
        const rows = (list as DockerContainer[]).filter((c) => c.state === 'running')
        setContainers(rows)
        setContainerId(rows[0]?.id || '')
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, kind, contextId])

  if (!open) return null

  const activeKind: TerminalAddKind =
    kind === 'local' || kind === 'docker' || kind === 'ssh' ? kind : 'ssh'

  const updateSSH = (patch: Partial<SSHHost>) => {
    setError('')
    setSSH((f) => ({ ...f, ...patch }))
  }

  const submit = async () => {
    setError('')
    if (activeKind === 'local') {
      onLocal(workDir.trim() || undefined)
      onClose()
      return
    }
    setSaving(true)
    try {
      if (activeKind === 'ssh') {
        if (!ssh.name.trim()) throw new Error(t('sshHost.errName'))
        if (!ssh.host.trim()) throw new Error(t('sshHost.errHost'))
        if (!ssh.user.trim()) throw new Error(t('sshHost.errUser'))
        if (!ssh.port || ssh.port <= 0) throw new Error(t('sshHost.errPort'))
        if (!ssh.keyPath.trim() && !ssh.password) throw new Error(t('sshHost.errAuth'))
        await api.saveSSHHost({ ...ssh, id: '', touchCloud: true })
        onSSHSaved()
        onClose()
        return
      }
      if (!contextId || !containerId) throw new Error(t('terminal.pickDockerContainer'))
      const host = await api.ensureDockerHost(contextId, containerId)
      onDockerAdded(host)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const primaryLabel =
    activeKind === 'local'
      ? t('terminal.connectAction')
      : activeKind === 'docker'
        ? t('common.add')
        : t('common.save')

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop" {...backdropDismissProps(onClose)}>
        <div
          className="wn-modal wn-modal-compact terminal-add-modal"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-labelledby="terminal-add-title"
        >
          <header className="wn-modal-header">
            <h2 id="terminal-add-title" className="wn-modal-title">
              {t('terminal.addKindTitle')}
            </h2>
            <nav className="terminal-add-kind-tabs" role="tablist" aria-label={t('terminal.addKindTitle')}>
              {KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={activeKind === item.id}
                  className={`terminal-add-kind-tab${activeKind === item.id ? ' is-active' : ''}`}
                  {...pressProps(() => {
                    setKind(item.id)
                    setError('')
                  })}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </nav>
          </header>

          <div className="wn-modal-body">
            <div className="wn-form" key={activeKind}>
              {activeKind === 'local' && (
                <div className="wn-field">
                  <label className="wn-label">{t('terminal.localWorkDir')}</label>
                  <input
                    className="wn-input"
                    value={workDir}
                    onChange={(e) => setWorkDir(e.target.value)}
                    placeholder={t('terminal.localWorkDirPlaceholder')}
                    autoFocus
                  />
                  <span className="wn-field-hint">{t('terminal.addKindLocalHint')}</span>
                </div>
              )}

              {activeKind === 'ssh' && (
                <>
                  <div className="wn-field">
                    <label className="wn-label">{t('sshHost.name')}</label>
                    <input
                      className="wn-input"
                      value={ssh.name}
                      onChange={(e) => updateSSH({ name: e.target.value })}
                      placeholder={t('sshHost.namePlaceholder')}
                      autoFocus
                    />
                  </div>
                  <div className="wn-form-row">
                    <div className="wn-field">
                      <label className="wn-label">{t('sshHost.host')}</label>
                      <input
                        className="wn-input"
                        value={ssh.host}
                        onChange={(e) => updateSSH({ host: e.target.value })}
                        placeholder={t('sshHost.hostPlaceholder')}
                      />
                    </div>
                    <div className="wn-field wn-field-narrow">
                      <label className="wn-label">{t('sshHost.port')}</label>
                      <input
                        className="wn-input"
                        type="number"
                        min={1}
                        max={65535}
                        value={ssh.port}
                        onChange={(e) => updateSSH({ port: Number(e.target.value) || 22 })}
                      />
                    </div>
                  </div>
                  <div className="wn-field">
                    <label className="wn-label">{t('sshHost.user')}</label>
                    <input
                      className="wn-input"
                      value={ssh.user}
                      onChange={(e) => updateSSH({ user: e.target.value })}
                    />
                  </div>
                  <div className="wn-field">
                    <label className="wn-label">{t('sshHost.keyPath')}</label>
                    <input
                      className="wn-input"
                      value={ssh.keyPath}
                      onChange={(e) => updateSSH({ keyPath: e.target.value })}
                      placeholder={t('sshHost.keyPathPlaceholder')}
                    />
                  </div>
                  <div className="wn-field">
                    <label className="wn-label">{t('sshHost.password')}</label>
                    <input
                      className="wn-input"
                      type="password"
                      value={ssh.password}
                      onChange={(e) => updateSSH({ password: e.target.value })}
                      placeholder={t('sshHost.passwordPlaceholder')}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}

              {activeKind === 'docker' && (
                <>
                  <div className="wn-field">
                    <label className="wn-label">{t('terminal.dockerContext')}</label>
                    <Select
                      value={contextId}
                      placeholder={loadingCtx ? t('common.loading') : t('terminal.pickDockerContext')}
                      options={contexts.map((c) => ({ value: c.id, label: c.name || c.endpoint || c.id }))}
                      onChange={setContextId}
                      disabled={loadingCtx || contexts.length === 0}
                    />
                  </div>
                  <div className="wn-field">
                    <label className="wn-label">{t('terminal.dockerContainer')}</label>
                    <Select
                      value={containerId}
                      placeholder={
                        loadingList
                          ? t('common.loading')
                          : containers.length === 0
                            ? t('terminal.noRunningContainers')
                            : t('terminal.pickDockerContainer')
                      }
                      options={containers.map((c) => ({
                        value: c.id,
                        label: `${c.name || c.shortId} · ${c.image || c.state}`,
                      }))}
                      onChange={setContainerId}
                      disabled={loadingList || containers.length === 0}
                    />
                  </div>
                </>
              )}
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
              {saving ? t('common.saving') : primaryLabel}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

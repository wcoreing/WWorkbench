import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import type { SSHForwardActive, SSHForwardPreset, SSHHost } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPlus } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import { SSHForwardModal } from './SSHForwardModal'
import { useSSHTrustConfirm } from './useSSHTrustConfirm'

interface Props {
  hosts: SSHHost[]
  onStatus: (msg: string) => void
}

/** SSHForwardPanel 终端侧栏端口转发管理。 */
export function SSHForwardPanel({ hosts, onStatus }: Props) {
  const { t } = useI18n()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [active, setActive] = useState<SSHForwardActive[]>([])
  const [presets, setPresets] = useState<SSHForwardPreset[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SSHForwardPreset | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<SSHForwardPreset | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([api.listActiveSSHForwards(), api.listSSHForwardPresets()])
      setActive(a as SSHForwardActive[])
      setPresets(p as SSHForwardPreset[])
    } catch (e) {
      onStatus((e as Error).message)
    }
  }, [onStatus])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const startPreset = async (preset: SSHForwardPreset) => {
    const host = hosts.find((h) => h.id === preset.sshHostId)
    if (!host) {
      onStatus(t('terminal.errHostNotFound'))
      return
    }
    setActingId(preset.id)
    try {
      const out = await withSSHHostTrust(
        host.host,
        host.port,
        () =>
          api.startSSHForward(
            model.SSHForwardStartDO.createFrom({
              presetId: preset.id,
              name: preset.name,
              sshHostId: preset.sshHostId,
              localPort: preset.localPort,
              remoteHost: preset.remoteHost,
              remotePort: preset.remotePort,
            }),
          ),
        confirmTrust,
      )
      onStatus(t('sshForward.started', { addr: out.localAddr }))
      await refresh()
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const stopForward = async (id: string) => {
    setActingId(id)
    try {
      await api.stopSSHForward(id)
      onStatus(t('sshForward.stopped'))
      await refresh()
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setActingId(null)
    }
  }

  const copyAddr = (addr: string) => {
    void navigator.clipboard.writeText(addr).then(() => onStatus(t('sshForward.copied', { addr })))
  }

  return (
    <>
      <section className="sidebar-section ssh-forward-section">
        <div className="sidebar-header">
          <span>{t('sshForward.title')}</span>
          <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('sshForward.newPreset')} onClick={() => { setEditing(null); setModalOpen(true) }}>
            <IconPlus size={14} />
          </button>
        </div>
        <div className="sidebar-body">
          <div className="ssh-forward-subhead">{t('sshForward.active')}</div>
          {active.length === 0 ? (
            <div className="empty-hint">{t('sshForward.emptyActive')}</div>
          ) : (
            <ul className="conn-list ssh-forward-list">
              {active.map((f) => (
                <li key={f.id} className="conn-item ssh-forward-item">
                  <div className="conn-meta">
                    <span className="conn-name">{f.name}</span>
                    <span className="conn-host" title={t('sshForward.route', { local: f.localAddr, remote: `${f.remoteHost}:${f.remotePort}` })}>
                      {f.localAddr} → {f.remoteHost}:{f.remotePort}
                    </span>
                  </div>
                  <div className="ssh-forward-actions">
                    <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" onClick={() => copyAddr(f.localAddr)}>{t('common.copy')}</button>
                    <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" disabled={actingId === f.id} onClick={() => void stopForward(f.id)}>{t('sshForward.stop')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="ssh-forward-subhead">{t('sshForward.presets')}</div>
          {presets.length === 0 ? (
            <div className="empty-hint">{t('sshForward.emptyPresets')}</div>
          ) : (
            <ul className="conn-list ssh-forward-list">
              {presets.map((p) => (
                <li key={p.id} className="conn-item ssh-forward-item" onDoubleClick={() => { setEditing(p); setModalOpen(true) }}>
                  <div className="conn-meta">
                    <span className="conn-name">{p.name}</span>
                    <span className="conn-host">
                      {(p.localPort ? `:${p.localPort}` : ':*')} → {p.remoteHost}:{p.remotePort}
                    </span>
                  </div>
                  <div className="ssh-forward-actions">
                    <button type="button" className="wn-btn wn-btn-xs wn-btn-primary" disabled={actingId === p.id || !hosts.some((h) => h.id === p.sshHostId)} onClick={() => void startPreset(p)}>{t('sshForward.start')}</button>
                    <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" onClick={() => setDeleteTarget(p)}>{t('common.delete')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="empty-hint mock-hint">{t('terminal.portForwardHint')}</div>
        </div>
      </section>

      <SSHForwardModal
        open={modalOpen}
        hosts={hosts}
        initial={editing ?? undefined}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          onStatus(t('sshForward.saved'))
          void refresh()
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('sshForward.deletePresetTitle')}
        message={deleteTarget ? t('sshForward.deletePresetMsg', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          const p = deleteTarget
          setDeleteTarget(null)
          if (!p) return
          void api.deleteSSHForwardPreset(p.id).then(() => {
            onStatus(t('sshForward.deleted'))
            void refresh()
          })
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      {trustDialog}
    </>
  )
}

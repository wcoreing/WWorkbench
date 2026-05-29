import { useEffect, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { model } from '../../../wailsjs/go/models'
import '../../components/ui.css'

interface DockerContextModalProps {
  open: boolean
  hosts: SSHHost[]
  initialHostId?: string
  onClose: () => void
  onSaved: () => void
}

/** DockerContextModal 添加 SSH 远程 Docker 上下文。 */
export function DockerContextModal({ open, hosts, initialHostId, onClose, onSaved }: DockerContextModalProps) {
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
      setError('请选择 SSH 主机')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = new model.DockerContextDO({
        id: crypto.randomUUID(),
        name: name.trim() || '远程 Docker',
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
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div
        className="wn-modal wn-modal-compact"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="docker-context-modal-title"
      >
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="docker-context-modal-title" className="wn-modal-title">
              添加远程 Docker
            </h2>
            <span className="wn-modal-tag">Docker</span>
          </div>
          <p className="wn-modal-desc">通过 SSH 连接远端 Docker 引擎（/var/run/docker.sock）</p>
        </header>

        <div className="wn-modal-body">
          {hosts.length === 0 ? (
            <p className="conn-ssh-hint">请先在「终端」产品线保存 SSH 主机。</p>
          ) : (
            <div className="wn-form">
              <div className="wn-field">
                <label className="wn-label" htmlFor="docker-ctx-host">
                  SSH 主机
                </label>
                <select
                  id="docker-ctx-host"
                  className="wn-select"
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                >
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.user}@{h.host})
                    </option>
                  ))}
                </select>
              </div>
              <div className="wn-field">
                <label className="wn-label" htmlFor="docker-ctx-name">
                  显示名称
                </label>
                <input
                  id="docker-ctx-name"
                  className="wn-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="远程 Docker"
                />
              </div>
            </div>
          )}
          {error && <div className="wn-form-msg error">{error}</div>}
        </div>

        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-primary"
            onClick={() => void submit()}
            disabled={saving || hosts.length === 0}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  )
}

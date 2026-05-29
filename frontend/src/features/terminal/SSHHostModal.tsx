import { useEffect, useState } from 'react'
import type { SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { withSSHHostTrust } from '../../api/sshTrust'
import { useSSHTrustConfirm } from './useSSHTrustConfirm'
import '../../components/ui.css'

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
function validateSSHHostForm(form: SSHHost): string | null {
  if (!form.name.trim()) return '请填写连接名称'
  if (!form.host.trim()) return '请填写主机地址'
  if (!form.user.trim()) return '请填写用户名'
  if (!form.port || form.port <= 0) return '请填写有效端口'
  if (!form.keyPath.trim() && !form.password && !form.id) {
    return '请填写 SSH 密码或私钥路径'
  }
  return null
}

/** SSH 主机配置弹窗 */
export function SSHHostModal({ open, initial, onClose, onSaved }: Props) {
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [form, setForm] = useState<SSHHost>(emptyHost())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [testing, setTesting] = useState(false)
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
    const invalid = validateSSHHostForm(form)
    if (invalid) {
      setError(invalid)
      return
    }
    setTesting(true)
    setError('')
    setSuccess('')
    try {
      await withSSHHostTrust(form.host, form.port, () => api.testSSHHost(form), confirmTrust)
      setSuccess('SSH 连接成功')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const invalid = validateSSHHostForm(form)
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
  const busy = testing || saving

  return (
    <>
      <div className="wn-modal-backdrop" onClick={onClose}>
      <div
        className="wn-modal wn-modal-compact"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="ssh-host-modal-title"
      >
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="ssh-host-modal-title" className="wn-modal-title">
              {isEdit ? '编辑 SSH 主机' : '新建 SSH 主机'}
            </h2>
            <span className="wn-modal-tag">SSH</span>
          </div>
          <p className="wn-modal-desc">连接信息加密保存在本地</p>
        </header>

        <div className="wn-modal-body">
          <div className="wn-form">
            <div className="wn-field">
              <label className="wn-label" htmlFor="ssh-host-name">
                连接名称
              </label>
              <input
                id="ssh-host-name"
                className="wn-input"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="例如：生产跳板机"
                autoFocus
              />
            </div>

            <div className="wn-form-row">
              <div className="wn-field">
                <label className="wn-label" htmlFor="ssh-host-addr">
                  主机
                </label>
                <input
                  id="ssh-host-addr"
                  className="wn-input"
                  value={form.host}
                  onChange={(e) => update({ host: e.target.value })}
                  placeholder="公网 IP 或域名"
                />
              </div>
              <div className="wn-field wn-field-narrow">
                <label className="wn-label" htmlFor="ssh-host-port">
                  端口
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
                用户名
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
                    私钥路径
                  </label>
                  <input
                    id="ssh-host-key"
                    className="wn-input"
                    value={form.keyPath}
                    onChange={(e) => update({ keyPath: e.target.value })}
                    placeholder="例如 ~/.ssh/id_rsa"
                  />
                </div>
                <div className="wn-field">
                  <label className="wn-label" htmlFor="ssh-host-pass">
                    SSH 密码 / 私钥口令
                  </label>
                  <input
                    id="ssh-host-pass"
                    className="wn-input"
                    type="password"
                    value={form.password}
                    onChange={(e) => update({ password: e.target.value })}
                    placeholder="无密钥时填 SSH 登录密码；加密私钥填口令"
                  />
                </div>
                <p className="conn-ssh-hint">用于终端产品线远程登录，密码或私钥二选一即可</p>
              </div>
            </div>
          </div>

          {error && <div className="wn-form-msg error">{error}</div>}
          {success && <div className="wn-form-msg success">{success}</div>}
        </div>

        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="wn-btn wn-btn-tool" onClick={handleTest} disabled={busy}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={handleSave} disabled={busy}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
      {trustDialog}
    </>
  )
}

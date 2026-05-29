import { useEffect, useState } from 'react'
import type { Connection, SSHHost } from '../../api/types'
import { api } from '../../api/client'
import '../../components/ui.css'

interface Props {
  open: boolean
  initial?: Connection | null
  onClose: () => void
  onSaved: () => void
}

type SSHSource = 'host' | 'manual'

const emptyConn = (): Connection => ({
  id: '',
  name: '',
  group: '',
  dbType: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: '',
  charset: 'utf8mb4',
  sshEnabled: false,
  sshHostId: '',
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshKeyPath: '',
  sshPassword: '',
  createdAt: 0,
  updatedAt: 0,
})

/** validateConnectionForm 校验连接表单必填项。 */
function validateConnectionForm(form: Connection, sshSource: SSHSource): string | null {
  if (!form.name.trim()) return '请填写连接名称'
  if (!form.host.trim()) return '请填写主机地址'
  if (!form.user.trim()) return '请填写用户名'
  if (!form.port || form.port <= 0) return '请填写有效端口'
  if (form.sshEnabled) {
    if (sshSource === 'host') {
      if (!form.sshHostId) return '请选择 SSH 主机'
    } else {
      if (!form.sshHost.trim()) return '请填写 SSH 主机'
      if (!form.sshUser.trim()) return '请填写 SSH 用户名'
      if (!form.sshKeyPath.trim() && !form.sshPassword) return '请填写 SSH 密码或私钥路径'
    }
  }
  return null
}

export function ConnectionModal({ open, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Connection>(emptyConn())
  const [sshHosts, setSshHosts] = useState<SSHHost[]>([])
  const [sshSource, setSshSource] = useState<SSHSource>('manual')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setSuccess('')
    api.listSSHHosts().then(setSshHosts).catch(() => setSshHosts([]))
    if (!initial?.id) {
      setForm(initial ? { ...emptyConn(), ...initial } : emptyConn())
      setSshSource(initial?.sshHostId ? 'host' : 'manual')
      return
    }
    let cancelled = false
    setForm({ ...initial, password: '', sshPassword: '' })
    setSshSource(initial.sshHostId ? 'host' : 'manual')
    api
      .getConnection(initial.id)
      .then((conn) => {
        if (!cancelled) {
          setForm(conn)
          setSshSource(conn.sshHostId ? 'host' : 'manual')
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [open, initial?.id])

  if (!open) return null

  const update = (patch: Partial<Connection>) => {
    setSuccess('')
    setError('')
    setForm((f) => ({ ...f, ...patch }))
  }

  /** switchSSHSource 切换 SSH 配置来源。 */
  const switchSSHSource = (source: SSHSource) => {
    setSshSource(source)
    if (source === 'host') {
      update({ sshHostId: form.sshHostId || sshHosts[0]?.id || '', sshHost: '', sshUser: '', sshKeyPath: '', sshPassword: '' })
    } else {
      update({ sshHostId: '' })
    }
  }

  const buildPayload = (): Connection => {
    if (form.sshEnabled && sshSource === 'host') {
      return { ...form, sshHost: '', sshUser: '', sshKeyPath: '', sshPassword: '', sshPort: 22 }
    }
    if (form.sshEnabled && sshSource === 'manual') {
      return { ...form, sshHostId: '' }
    }
    return { ...form, sshHostId: '', sshHost: '', sshUser: '', sshKeyPath: '', sshPassword: '' }
  }

  const handleTest = async () => {
    const payload = buildPayload()
    const invalid = validateConnectionForm(payload, sshSource)
    if (invalid) {
      setError(invalid)
      return
    }
    setTesting(true)
    setError('')
    setSuccess('')
    try {
      await api.testConnection(payload)
      setSuccess(payload.sshEnabled ? 'SSH 隧道与数据库连接成功' : '连接测试成功')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const payload = buildPayload()
    const invalid = validateConnectionForm(payload, sshSource)
    if (invalid) {
      setError(invalid)
      return
    }
    if (!payload.id) payload.id = crypto.randomUUID()
    setSaving(true)
    setError('')
    try {
      await api.saveConnection(payload)
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
  const selectedHost = sshHosts.find((h) => h.id === form.sshHostId)

  return (
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div className="wn-modal wn-modal-compact" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="conn-modal-title">
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="conn-modal-title" className="wn-modal-title">
              {isEdit ? '编辑连接' : '新建连接'}
            </h2>
            <span className="wn-modal-tag">MySQL</span>
          </div>
          <p className="wn-modal-desc">连接信息加密保存在本地</p>
        </header>

        <div className="wn-modal-body">
          <div className="wn-form">
            <div className="wn-field">
              <label className="wn-label" htmlFor="conn-name">
                连接名称
              </label>
              <input
                id="conn-name"
                className="wn-input"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="例如：生产环境"
                autoFocus
              />
            </div>

            <div className="wn-field">
              <label className="wn-label" htmlFor="conn-group">
                分组
              </label>
              <input
                id="conn-group"
                className="wn-input"
                value={form.group}
                onChange={(e) => update({ group: e.target.value })}
                placeholder="例如：生产 / 测试（可选）"
              />
            </div>

            <div className="wn-form-row">
              <div className="wn-field">
                <label className="wn-label" htmlFor="conn-host">
                  主机
                </label>
                <input
                  id="conn-host"
                  className="wn-input"
                  value={form.host}
                  onChange={(e) => update({ host: e.target.value })}
                  placeholder="MySQL 地址（经 SSH 时为内网地址）"
                />
              </div>
              <div className="wn-field wn-field-narrow">
                <label className="wn-label" htmlFor="conn-port">
                  端口
                </label>
                <input
                  id="conn-port"
                  className="wn-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => update({ port: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="wn-form-row wn-form-row-equal">
              <div className="wn-field">
                <label className="wn-label" htmlFor="conn-user">
                  用户名
                </label>
                <input
                  id="conn-user"
                  className="wn-input"
                  value={form.user}
                  onChange={(e) => update({ user: e.target.value })}
                />
              </div>
              <div className="wn-field">
                <label className="wn-label" htmlFor="conn-pass">
                  密码
                </label>
                <input
                  id="conn-pass"
                  className="wn-input"
                  type="password"
                  value={form.password}
                  onChange={(e) => update({ password: e.target.value })}
                  placeholder="可选"
                />
              </div>
            </div>

            <div className="wn-field">
              <label className="wn-label" htmlFor="conn-db">
                默认数据库
              </label>
              <input
                id="conn-db"
                className="wn-input"
                value={form.database}
                onChange={(e) => update({ database: e.target.value })}
                placeholder="可选"
              />
            </div>

            <div className="conn-ssh-block">
              <label className="wn-check conn-ssh-toggle">
                <input
                  type="checkbox"
                  checked={form.sshEnabled}
                  onChange={(e) => update({ sshEnabled: e.target.checked })}
                />
                <span>通过 SSH 隧道连接</span>
              </label>

              {form.sshEnabled && (
                <div className="conn-ssh-fields">
                  <div className="conn-ssh-source">
                    <label className="wn-check">
                      <input type="radio" name="ssh-source" checked={sshSource === 'host'} onChange={() => switchSSHSource('host')} />
                      <span>使用已保存 SSH 主机</span>
                    </label>
                    <label className="wn-check">
                      <input type="radio" name="ssh-source" checked={sshSource === 'manual'} onChange={() => switchSSHSource('manual')} />
                      <span>手动填写</span>
                    </label>
                  </div>

                  {sshSource === 'host' ? (
                    <div className="wn-field">
                      <label className="wn-label" htmlFor="ssh-host-pick">
                        SSH 主机
                      </label>
                      {sshHosts.length === 0 ? (
                        <p className="conn-ssh-hint">请先在「终端」或「文件」产品线添加 SSH 主机</p>
                      ) : (
                        <select
                          id="ssh-host-pick"
                          className="wn-select"
                          value={form.sshHostId}
                          onChange={(e) => update({ sshHostId: e.target.value })}
                        >
                          <option value="">选择主机…</option>
                          {sshHosts.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name} · {h.user}@{h.host}:{h.port}
                            </option>
                          ))}
                        </select>
                      )}
                      {selectedHost && (
                        <p className="conn-ssh-hint">
                          跳板机 {selectedHost.user}@{selectedHost.host}:{selectedHost.port}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="wn-form-row">
                        <div className="wn-field">
                          <label className="wn-label" htmlFor="ssh-host">
                            SSH 主机
                          </label>
                          <input
                            id="ssh-host"
                            className="wn-input"
                            value={form.sshHost}
                            onChange={(e) => update({ sshHost: e.target.value })}
                            placeholder="跳板机公网 IP 或域名"
                          />
                        </div>
                        <div className="wn-field wn-field-narrow">
                          <label className="wn-label" htmlFor="ssh-port">
                            SSH 端口
                          </label>
                          <input
                            id="ssh-port"
                            className="wn-input"
                            type="number"
                            min={1}
                            max={65535}
                            value={form.sshPort}
                            onChange={(e) => update({ sshPort: Number(e.target.value) || 22 })}
                          />
                        </div>
                      </div>
                      <div className="wn-field">
                        <label className="wn-label" htmlFor="ssh-user">
                          SSH 用户名
                        </label>
                        <input
                          id="ssh-user"
                          className="wn-input"
                          value={form.sshUser}
                          onChange={(e) => update({ sshUser: e.target.value })}
                        />
                      </div>
                      <div className="wn-field">
                        <label className="wn-label" htmlFor="ssh-key">
                          私钥路径
                        </label>
                        <input
                          id="ssh-key"
                          className="wn-input"
                          value={form.sshKeyPath}
                          onChange={(e) => update({ sshKeyPath: e.target.value })}
                          placeholder="例如 ~/.ssh/id_rsa"
                        />
                      </div>
                      <div className="wn-field">
                        <label className="wn-label" htmlFor="ssh-pass">
                          SSH 密码 / 私钥口令
                        </label>
                        <input
                          id="ssh-pass"
                          className="wn-input"
                          type="password"
                          value={form.sshPassword}
                          onChange={(e) => update({ sshPassword: e.target.value })}
                          placeholder="无密钥时填 SSH 登录密码；加密私钥填口令"
                        />
                      </div>
                    </>
                  )}
                  <p className="conn-ssh-hint">MySQL 主机填 SSH 可达的内网地址，程序在本地建立端口转发</p>
                </div>
              )}
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
  )
}

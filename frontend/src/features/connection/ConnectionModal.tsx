import { useEffect, useState } from 'react'
import type { Connection, SSHHost } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import '../../components/ui.css'

interface Props {
  open: boolean
  initial?: Connection | null
  onClose: () => void
  onSaved: () => void
}

type SSHSource = 'host' | 'manual'

type DbType = 'mysql' | 'postgresql' | 'redis' | 'sqlite'

const DB_PRESETS: Record<DbType, { port: number; database: string; charset: string; host: string; user: string }> = {
  mysql: { port: 3306, database: '', charset: 'utf8mb4', host: '127.0.0.1', user: 'root' },
  postgresql: { port: 5432, database: 'postgres', charset: '', host: '127.0.0.1', user: 'postgres' },
  redis: { port: 6379, database: '0', charset: '', host: '127.0.0.1', user: '' },
  sqlite: { port: 0, database: 'main', charset: '', host: '', user: '' },
}

const DB_TYPE_OPTIONS: DbType[] = ['mysql', 'postgresql', 'redis', 'sqlite']

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

type TFn = (key: string, params?: Record<string, string | number>) => string

/** validateConnectionForm 校验连接表单必填项。 */
function validateConnectionForm(form: Connection, sshSource: SSHSource, t: TFn): string | null {
  if (!form.name.trim()) return t('connection.errName')
  if (!form.host.trim()) {
    return form.dbType === 'sqlite' ? t('connection.errFilePath') : t('connection.errHost')
  }
  if (form.dbType === 'sqlite') return null
  if (form.dbType !== 'redis' && !form.user.trim()) return t('connection.errUser')
  if (!form.port || form.port <= 0) return t('connection.errPort')
  if (form.sshEnabled) {
    if (sshSource === 'host') {
      if (!form.sshHostId) return t('connection.errSshHostPick')
    } else {
      if (!form.sshHost.trim()) return t('connection.errSshHost')
      if (!form.sshUser.trim()) return t('connection.errSshUser')
      if (!form.sshKeyPath.trim() && !form.sshPassword) return t('connection.errSshAuth')
    }
  }
  return null
}

/** ConnectionModal 数据库连接新建/编辑弹窗。 */
export function ConnectionModal({ open, initial, onClose, onSaved }: Props) {
  const { t } = useI18n()
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

  /** applyDbType 切换数据库类型并套用默认端口等。 */
  const applyDbType = (dbType: DbType) => {
    const preset = DB_PRESETS[dbType]
    update({
      dbType,
      port: preset.port,
      database: preset.database,
      charset: preset.charset,
      host: preset.host,
      user: preset.user,
      sshEnabled: dbType === 'sqlite' ? false : form.sshEnabled,
    })
  }

  const isSqlite = form.dbType === 'sqlite'

  const dbTypeLabel = t(`connection.dbType_${form.dbType}`)

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
    const invalid = validateConnectionForm(payload, sshSource, t)
    if (invalid) {
      setError(invalid)
      return
    }
    setTesting(true)
    setError('')
    setSuccess('')
    try {
      await api.testConnection(payload)
      setSuccess(payload.sshEnabled ? t('connection.testOkSsh') : t('connection.testOk'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const payload = buildPayload()
    const invalid = validateConnectionForm(payload, sshSource, t)
    if (invalid) {
      setSuccess('')
      setError(invalid)
      return
    }
    if (!payload.id) payload.id = crypto.randomUUID()
    setSaving(true)
    setError('')
    setSuccess('')
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
              {isEdit ? t('connection.editTitle') : t('connection.newTitle')}
            </h2>
            <span className="wn-modal-tag">{dbTypeLabel}</span>
          </div>
          <p className="wn-modal-desc">{t('connection.desc')}</p>
        </header>

        <div className="wn-modal-body">
          <div className="wn-form">
            <div className="wn-field">
              <label className="wn-label" htmlFor="conn-name">
                {t('connection.name')}
              </label>
              <input
                id="conn-name"
                className="wn-input"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={t('connection.namePlaceholder')}
                autoFocus
              />
            </div>

            <div className="wn-field">
              <label className="wn-label" htmlFor="conn-group">
                {t('connection.group')}
              </label>
              <input
                id="conn-group"
                className="wn-input"
                value={form.group}
                onChange={(e) => update({ group: e.target.value })}
                placeholder={t('connection.groupPlaceholder')}
              />
            </div>

            <div className="wn-field">
              <label className="wn-label" htmlFor="conn-dbtype">
                {t('connection.dbType')}
              </label>
              <select
                id="conn-dbtype"
                className="wn-input"
                value={form.dbType || 'mysql'}
                onChange={(e) => applyDbType(e.target.value as DbType)}
              >
                {DB_TYPE_OPTIONS.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`connection.dbType_${ty}`)}
                  </option>
                ))}
              </select>
            </div>

            {isSqlite ? (
              <div className="wn-field">
                <label className="wn-label" htmlFor="conn-host">
                  {t('connection.filePath')}
                </label>
                <input
                  id="conn-host"
                  className="wn-input"
                  value={form.host}
                  onChange={(e) => update({ host: e.target.value })}
                  placeholder={t('connection.filePathPlaceholder')}
                />
                <p className="conn-ssh-hint">{t('connection.sqliteHint')}</p>
              </div>
            ) : (
              <>
                <div className="wn-form-row">
                  <div className="wn-field">
                    <label className="wn-label" htmlFor="conn-host">
                      {t('connection.host')}
                    </label>
                    <input
                      id="conn-host"
                      className="wn-input"
                      value={form.host}
                      onChange={(e) => update({ host: e.target.value })}
                      placeholder={t('connection.hostPlaceholder')}
                    />
                  </div>
                  <div className="wn-field wn-field-narrow">
                    <label className="wn-label" htmlFor="conn-port">
                      {t('connection.port')}
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
                      {t('connection.user')}
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
                      {t('connection.password')}
                    </label>
                    <input
                      id="conn-pass"
                      className="wn-input"
                      type="password"
                      value={form.password}
                      onChange={(e) => update({ password: e.target.value })}
                      placeholder={t('connection.optional')}
                    />
                  </div>
                </div>

                <div className="wn-field">
                  <label className="wn-label" htmlFor="conn-db">
                    {form.dbType === 'redis' ? t('connection.redisDb') : t('connection.defaultDb')}
                  </label>
                  <input
                    id="conn-db"
                    className="wn-input"
                    value={form.database}
                    onChange={(e) => update({ database: e.target.value })}
                    placeholder={form.dbType === 'redis' ? t('connection.redisDbPlaceholder') : t('connection.optional')}
                  />
                </div>
              </>
            )}

            {!isSqlite && (
            <div className="conn-ssh-block">
              <label className="wn-check conn-ssh-toggle">
                <input
                  type="checkbox"
                  checked={form.sshEnabled}
                  onChange={(e) => update({ sshEnabled: e.target.checked })}
                />
                <span>{t('connection.sshTunnel')}</span>
              </label>

              {form.sshEnabled && (
                <div className="conn-ssh-fields">
                  <div className="conn-ssh-source">
                    <label className="wn-check">
                      <input type="radio" name="ssh-source" checked={sshSource === 'host'} onChange={() => switchSSHSource('host')} />
                      <span>{t('connection.useSavedHost')}</span>
                    </label>
                    <label className="wn-check">
                      <input type="radio" name="ssh-source" checked={sshSource === 'manual'} onChange={() => switchSSHSource('manual')} />
                      <span>{t('connection.manual')}</span>
                    </label>
                  </div>

                  {sshSource === 'host' ? (
                    <div className="wn-field">
                      <label className="wn-label" htmlFor="ssh-host-pick">
                        {t('connection.sshHost')}
                      </label>
                      {sshHosts.length === 0 ? (
                        <p className="conn-ssh-hint">{t('connection.noSshHosts')}</p>
                      ) : (
                        <select
                          id="ssh-host-pick"
                          className="wn-select"
                          value={form.sshHostId}
                          onChange={(e) => update({ sshHostId: e.target.value })}
                        >
                          <option value="">{t('connection.pickHost')}</option>
                          {sshHosts.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name} · {h.user}@{h.host}:{h.port}
                            </option>
                          ))}
                        </select>
                      )}
                      {selectedHost && (
                        <p className="conn-ssh-hint">
                          {t('connection.jumpHost', {
                            user: selectedHost.user,
                            host: selectedHost.host,
                            port: selectedHost.port,
                          })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="wn-form-row">
                        <div className="wn-field">
                          <label className="wn-label" htmlFor="ssh-host">
                            {t('connection.sshHost')}
                          </label>
                          <input
                            id="ssh-host"
                            className="wn-input"
                            value={form.sshHost}
                            onChange={(e) => update({ sshHost: e.target.value })}
                            placeholder={t('connection.sshHostPlaceholder')}
                          />
                        </div>
                        <div className="wn-field wn-field-narrow">
                          <label className="wn-label" htmlFor="ssh-port">
                            {t('connection.sshPort')}
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
                          {t('connection.sshUser')}
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
                          {t('connection.keyPath')}
                        </label>
                        <input
                          id="ssh-key"
                          className="wn-input"
                          value={form.sshKeyPath}
                          onChange={(e) => update({ sshKeyPath: e.target.value })}
                          placeholder={t('connection.keyPathPlaceholder')}
                        />
                      </div>
                      <div className="wn-field">
                        <label className="wn-label" htmlFor="ssh-pass">
                          {t('connection.sshPassword')}
                        </label>
                        <input
                          id="ssh-pass"
                          className="wn-input"
                          type="password"
                          value={form.sshPassword}
                          onChange={(e) => update({ sshPassword: e.target.value })}
                          placeholder={t('connection.sshPasswordPlaceholder')}
                        />
                      </div>
                    </>
                  )}
                  <p className="conn-ssh-hint">{t('connection.sshHint')}</p>
                </div>
              )}
            </div>
            )}
          </div>

          {error && <div className="wn-form-msg error">{error}</div>}
          {success && <div className="wn-form-msg success">{success}</div>}
        </div>

        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="wn-btn wn-btn-tool" onClick={handleTest} disabled={busy}>
            {testing ? t('connection.testing') : t('connection.test')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={handleSave} disabled={busy}>
            {saving ? t('connection.saving') : t('common.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}

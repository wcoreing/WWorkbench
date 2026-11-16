import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import { formatBytes, onHomeSyncProgress, type HomeSyncProgressEvent } from '../api/homeSyncEvents'
import { ModalPortal, backdropDismissProps, pressProps } from '../components/compat'
import { useI18n } from '../i18n'
import { notify } from '../notify'
import { model } from '../../wailsjs/go/models'

const LAST_SYNC_AT = 'home_last_sync_at'
const LAST_SYNC_NOTE = 'home_last_sync_note'

/** 与 wwb-home / homeclient.ValidateAuth 对齐的前端预检。 */
function validateAuthLocal(username: string, password: string): string {
  const u = username.trim().toLowerCase()
  if (!u || u.length < 2 || u.length > 64 || !/^[a-z0-9._-]+$/.test(u)) {
    return '用户名需 2～64 位，仅限字母、数字、点、下划线、连字符'
  }
  if (password.length < 6) return '密码至少 6 位'
  if (password.length > 128) return '密码最长 128 位'
  return ''
}

function formatSync(res: model.HomeSyncResultDO): string {
  const parts = [
    `projects=${res.projects}`,
    `ssh=${res.sshHosts}`,
    `db=${res.connections}`,
    `docs=${res.docs}`,
  ]
  if (res.bytes) {
    parts.push(
      res.bytesGzip && res.bytesGzip !== res.bytes
        ? `${formatBytes(res.bytes)}→gzip ${formatBytes(res.bytesGzip)}`
        : formatBytes(res.bytes),
    )
  }
  if (res.durationMs) parts.push(`${res.durationMs}ms`)
  return parts.join(' · ')
}

function formatSyncWhen(iso: string, locale: string): string {
  const raw = iso.trim()
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

/** ShellAccountMenu 顶栏账号：居中弹窗；登录后自动全量同步。 */
export function ShellAccountMenu() {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<model.HomeStatusDO | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<HomeSyncProgressEvent | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [lastSyncNote, setLastSyncNote] = useState('')

  const refresh = useCallback(async () => {
    const st = await api.getHomeStatus()
    setStatus(st)
    const settings = await api.listAppSettings()
    setLastSyncAt(String(settings[LAST_SYNC_AT] || ''))
    setLastSyncNote(String(settings[LAST_SYNC_NOTE] || ''))
  }, [])

  useEffect(() => {
    void refresh().catch((e) => setError((e as Error).message))
  }, [refresh])

  useEffect(() => {
    return onHomeSyncProgress((evt) => setProgress(evt))
  }, [])

  const close = () => {
    if (busy) return
    setOpen(false)
    setError('')
    setProgress(null)
  }

  const authBody = () =>
    model.HomeAuthDO.createFrom({
      username: username.trim(),
      password,
      device: '',
    })

  const afterAuth = (st: model.HomeStatusDO, okMsg: string) => {
    setStatus(st)
    setPassword('')
    if (st.error) {
      notify.success(okMsg)
      setError(st.error)
      return
    }
    const size = progress?.bytes ? ` · ${formatBytes(progress.bytes)}` : ''
    notify.success(`${okMsg} · ${t('shell.accountSynced')}${size}`)
    void refresh().catch(() => {})
    close()
  }

  const login = async () => {
    const localErr = validateAuthLocal(username, password)
    if (localErr) {
      setError(localErr)
      return
    }
    setBusy(true)
    setError('')
    setProgress({ stage: 'start', percent: 0, message: t('shell.accountSyncStarting') })
    try {
      const st = await api.homeLogin(authBody())
      afterAuth(st, t('shell.accountLoggedIn'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    const localErr = validateAuthLocal(username, password)
    if (localErr) {
      setError(localErr)
      return
    }
    setBusy(true)
    setError('')
    setProgress({ stage: 'start', percent: 0, message: t('shell.accountSyncStarting') })
    try {
      const st = await api.homeRegister(authBody())
      afterAuth(st, t('shell.accountRegistered'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      const st = await api.homeLogout()
      setStatus(st)
      notify.success(t('shell.accountLoggedOut'))
      close()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runSync = async (
    kind: 'now' | 'push' | 'pull',
    okKey: 'shell.accountSyncOk' | 'shell.accountSyncPushOk' | 'shell.accountSyncPullOk',
  ) => {
    setBusy(true)
    setError('')
    setProgress({ stage: 'start', percent: 0, message: t('shell.accountSyncStarting') })
    try {
      const res =
        kind === 'push'
          ? await api.homeSyncPush()
          : kind === 'pull'
            ? await api.homeSyncPull()
            : await api.homeSyncNow()
      notify.success(`${t(okKey)} · ${formatSync(res)}`)
      await refresh()
      setProgress({
        stage: 'done',
        percent: 100,
        message: t(okKey),
        bytes: res.bytes,
        docs: res.docs,
        durationMs: res.durationMs,
      })
    } catch (e) {
      setError((e as Error).message)
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !busy) {
      e.preventDefault()
      void login()
    }
  }

  const label = status?.loggedIn
    ? status.username || t('shell.account')
    : t('shell.account')

  const pct = Math.max(0, Math.min(100, progress?.percent ?? 0))
  const lastWhen = formatSyncWhen(lastSyncAt, locale)

  return (
    <div className="shell-locale-menu">
      <button
        type="button"
        className={`wn-btn wn-btn-chrome${open ? ' active' : ''}`}
        title={t('shell.account')}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...pressProps(() => {
          setError('')
          setOpen(true)
          void refresh()
        })}
      >
        <span className="chrome-ai-label">{label}</span>
      </button>
      {open ? (
        <ModalPortal>
          <div className="wn-modal-backdrop wn-modal-backdrop-top" {...backdropDismissProps(close)}>
            <div
              className="wn-modal wn-modal-compact shell-account-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="shell-account-title"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <header className="wn-modal-header">
                <h2 id="shell-account-title" className="wn-modal-title">
                  {t('shell.account')}
                </h2>
              </header>
              <div className="wn-modal-body shell-account-modal-body">
                {status && !status.reachable ? (
                  <p className="shell-account-error">{status.error || t('shell.accountOffline')}</p>
                ) : null}
                {error ? <p className="shell-account-error">{error}</p> : null}
                {status?.loggedIn ? (
                  <p className="shell-account-current">
                    {t('shell.accountAs', { name: status.username || status.accountId || '—' })}
                    {status.reachable ? ` · ${t('shell.accountOnline')}` : ''}
                  </p>
                ) : (
                  <>
                    <label className="shell-account-field">
                      <span>{t('shell.accountUsername')}</span>
                      <input
                        className="wn-input"
                        value={username}
                        placeholder={t('shell.accountUsernamePh')}
                        autoComplete="username"
                        autoFocus
                        disabled={busy}
                        onChange={(e) => {
                          setUsername(e.target.value)
                          if (error) setError('')
                        }}
                        onKeyDown={onKeyDown}
                      />
                    </label>
                    <label className="shell-account-field">
                      <span>{t('shell.accountPassword')}</span>
                      <input
                        className="wn-input"
                        type="password"
                        value={password}
                        placeholder={t('shell.accountPasswordPh')}
                        autoComplete="current-password"
                        disabled={busy}
                        onChange={(e) => {
                          setPassword(e.target.value)
                          if (error) setError('')
                        }}
                        onKeyDown={onKeyDown}
                      />
                    </label>
                  </>
                )}
                {status?.loggedIn ? (
                  <div className="shell-account-sync-meta">
                    <p className="shell-account-hint">{t('shell.accountSecretHint')}</p>
                    <p className="shell-account-last">
                      {lastWhen
                        ? t('shell.accountLastSync', { when: lastWhen })
                        : t('shell.accountLastSyncNever')}
                    </p>
                    {lastSyncNote ? (
                      <p className="shell-account-last-note">{t('shell.accountLastSyncNote', { note: lastSyncNote })}</p>
                    ) : null}
                  </div>
                ) : null}
                {progress ? (
                  <div className="shell-account-progress" aria-live="polite">
                    <div className="shell-account-progress-bar">
                      <div className="shell-account-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="shell-account-progress-text">{progress.message}</p>
                    <p className="shell-account-progress-meta">
                      {progress.bytes != null && progress.bytes > 0
                        ? progress.bytesGzip && progress.bytesGzip !== progress.bytes
                          ? `${formatBytes(progress.bytes)} → gzip ${formatBytes(progress.bytesGzip)}`
                          : formatBytes(progress.bytes)
                        : ''}
                      {progress.docs != null
                        ? `${progress.bytes ? ' · ' : ''}${progress.docs}${progress.docsTotal ? `/${progress.docsTotal}` : ''} 篇`
                        : ''}
                      {progress.durationMs != null && progress.durationMs > 0
                        ? `${progress.bytes || progress.docs ? ' · ' : ''}${progress.durationMs}ms`
                        : ''}
                    </p>
                  </div>
                ) : null}
              </div>
              <footer className="wn-modal-footer shell-account-footer">
                {status?.loggedIn ? (
                  <>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={busy} {...pressProps(() => void logout())}>
                      {t('shell.accountLogout')}
                    </button>
                    <div className="shell-account-sync-actions">
                      <button
                        type="button"
                        className="wn-btn wn-btn-sm wn-btn-tool"
                        disabled={busy}
                        title={t('shell.accountSyncPush')}
                        {...pressProps(() => void runSync('push', 'shell.accountSyncPushOk'))}
                      >
                        {t('shell.accountSyncPush')}
                      </button>
                      <button
                        type="button"
                        className="wn-btn wn-btn-sm wn-btn-tool"
                        disabled={busy}
                        title={t('shell.accountSyncPull')}
                        {...pressProps(() => void runSync('pull', 'shell.accountSyncPullOk'))}
                      >
                        {t('shell.accountSyncPull')}
                      </button>
                      <button
                        type="button"
                        className="wn-btn wn-btn-sm wn-btn-primary"
                        disabled={busy}
                        {...pressProps(() => void runSync('now', 'shell.accountSyncOk'))}
                      >
                        {busy ? t('shell.accountSyncing') : t('shell.accountSyncNow')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={busy} {...pressProps(() => void register())}>
                      {t('shell.accountRegister')}
                    </button>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={busy} {...pressProps(() => void login())}>
                      {busy ? t('shell.accountSyncing') : t('shell.accountLogin')}
                    </button>
                  </>
                )}
              </footer>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  )
}

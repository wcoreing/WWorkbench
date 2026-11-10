import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { FileEntry, SSHHost } from '../../api/types'
import { ModalPortal, backdropDismissProps, pressProps } from '../../components/compat'
import { IconFolder, IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { parentRemotePath, splitPathCrumbs } from './sftpUtils'

export type SftpPathPickMode = 'file' | 'dir' | 'any'

type Props = {
  open: boolean
  title?: string
  sshHostId: string
  hosts: SSHHost[]
  initialPath?: string
  mode?: SftpPathPickMode
  onPick: (path: string) => void
  onCancel: () => void
}

/** SftpPathPicker 在当前页弹窗浏览指定 SSH 主机的远程文件（不切换文件产品线）。 */
export function SftpPathPicker({
  open,
  title,
  sshHostId,
  hosts,
  initialPath = '',
  mode = 'any',
  onPick,
  onCancel,
}: Props) {
  const { t } = useI18n()
  const [sessionId, setSessionId] = useState('')
  const [cwd, setCwd] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const host = useMemo(() => hosts.find((h) => h.id === sshHostId) ?? null, [hosts, sshHostId])
  const crumbs = useMemo(() => splitPathCrumbs(cwd, 'remote'), [cwd])
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [entries])

  const closeSession = useCallback(async (id: string) => {
    if (!id) return
    try {
      await api.closeSFTPSession(id)
    } catch {
      /* ignore */
    }
  }, [])

  const loadDir = useCallback(
    async (sid: string, nextPath: string) => {
      setBusy(true)
      setError('')
      setSelected(null)
      try {
        let path = nextPath
        if (!path) {
          path = await api.getSFTPHome(sid)
        }
        try {
          const list = await api.listSFTPDir(sid, path)
          setCwd(path)
          setEntries(list)
        } catch (listErr) {
          const parent = parentRemotePath(path)
          if (!parent || parent === path) throw listErr
          const list = await api.listSFTPDir(sid, parent)
          setCwd(parent)
          setEntries(list)
          const hit = list.find((e) => e.path === path)
          if (hit) setSelected(hit)
        }
      } catch (err) {
        setEntries([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    if (!sshHostId.trim()) {
      setError(t('backup.needSSHHost'))
      setEntries([])
      setSessionId('')
      return
    }
    let cancelled = false
    let openedId = ''
    setSelected(null)
    setError('')
    setBusy(true)
    void (async () => {
      try {
        const sess = await api.openSFTPSession(sshHostId)
        if (cancelled) {
          await api.closeSFTPSession(sess.sessionId).catch(() => {})
          return
        }
        openedId = sess.sessionId
        setSessionId(sess.sessionId)
        await loadDir(sess.sessionId, initialPath.trim())
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setBusy(false)
        }
      }
    })()
    return () => {
      cancelled = true
      if (openedId) void api.closeSFTPSession(openedId).catch(() => {})
    }
  }, [open, sshHostId, initialPath, loadDir, t])

  useEffect(() => {
    if (open) return
    const sid = sessionId
    if (!sid) return
    void closeSession(sid).then(() => setSessionId(''))
  }, [open, sessionId, closeSession])

  const pickedPath = selected?.path || cwd
  const canConfirm = (() => {
    if (!sshHostId.trim() || !pickedPath) return false
    if (mode === 'file') return Boolean(selected && !selected.isDir)
    if (mode === 'dir') return !selected || selected.isDir
    return true
  })()

  const enterDir = (path: string) => {
    if (!sessionId) return
    void loadDir(sessionId, path)
  }

  const goUp = () => {
    const parent = parentRemotePath(cwd)
    if (parent === cwd) return
    enterDir(parent)
  }

  const confirm = () => {
    if (!canConfirm || !pickedPath) return
    onPick(pickedPath)
  }

  const onRowActivate = (entry: FileEntry) => {
    if (entry.isDir) {
      enterDir(entry.path)
      return
    }
    setSelected(entry)
    if (mode === 'file' || mode === 'any') onPick(entry.path)
  }

  if (!open) return null

  const hostLabel = host ? `${host.name} · ${host.user}@${host.host}` : sshHostId

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" {...backdropDismissProps(onCancel)}>
        <div
          className="wn-modal remote-path-picker"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-labelledby="sftp-path-picker-title"
        >
          <header className="wn-modal-header wn-modal-header-bar">
            <h3 id="sftp-path-picker-title" className="wn-modal-title">
              {title || t('backup.pickPathTitle')}
            </h3>
            <button type="button" className="wn-modal-close-btn" {...pressProps(onCancel)} aria-label={t('common.cancel')}>
              ×
            </button>
          </header>

          <div className="wn-modal-body remote-path-picker-body">
            <div className="remote-path-picker-toolbar">
              <div className="remote-path-picker-host">
                <span className="wn-label">{t('backup.sshHost')}</span>
                <div className="remote-path-picker-host-name">{hostLabel || t('backup.needSSHHost')}</div>
              </div>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-sm"
                disabled={busy || !sessionId}
                title={t('common.refresh')}
                {...pressProps(() => sessionId && void loadDir(sessionId, cwd), {
                  disabled: busy || !sessionId,
                })}
              >
                <IconRefresh size={14} />
              </button>
            </div>

            <div className="remote-path-picker-crumbs">
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-ghost"
                disabled={busy || !sessionId}
                {...pressProps(goUp, { disabled: busy || !sessionId })}
              >
                ..
              </button>
              {crumbs.map((c) => (
                <button
                  key={c.path}
                  type="button"
                  className="remote-path-crumb"
                  disabled={busy || !sessionId}
                  {...pressProps(() => enterDir(c.path), { disabled: busy || !sessionId })}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {error ? <div className="remote-path-picker-error">{error}</div> : null}

            <ul className="remote-path-picker-list">
              {sorted.length === 0 && !busy ? (
                <li className="remote-path-picker-empty">{t('backup.pickPathEmpty')}</li>
              ) : (
                sorted.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={`remote-path-picker-row ${selected?.path === entry.path ? 'is-selected' : ''}`}
                      disabled={busy}
                      onClick={() => setSelected(entry)}
                      onDoubleClick={() => onRowActivate(entry)}
                    >
                      <span className="remote-path-picker-icon">
                        {entry.isDir ? <IconFolder size={14} /> : null}
                      </span>
                      <span className="remote-path-picker-name">{entry.name}</span>
                      {entry.isDir ? (
                        <span
                          className="remote-path-picker-enter"
                          onClick={(e) => {
                            e.stopPropagation()
                            enterDir(entry.path)
                          }}
                        >
                          {t('backup.pickPathEnter')}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="remote-path-picker-current">
              {t('backup.pickPathCurrent')}: <code>{pickedPath}</code>
            </div>
          </div>

          <footer className="wn-modal-footer" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" {...pressProps(onCancel)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-primary"
              disabled={busy || !canConfirm}
              {...pressProps(confirm, { disabled: busy || !canConfirm })}
            >
              {t('common.confirm')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

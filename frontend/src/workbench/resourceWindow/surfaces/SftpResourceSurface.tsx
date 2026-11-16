import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'
import { withSSHHostTrust } from '../../../api/sshTrust'
import type { FileEntry, ShellHost } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { formatBytes, formatModTime, parentRemotePath } from '../../../features/sftp/sftpUtils'
import { useSSHTrustConfirm } from '../../../features/terminal/useSSHTrustConfirm'
import { useI18n } from '../../../i18n'
import { openAsProduct } from '../openResource'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** SftpResourceSurface 嵌入式远程目录浏览（完整双栏仍走产品线）。 */
export function SftpResourceSurface({ window: win }: Props) {
  const { t } = useI18n()
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [host, setHost] = useState<ShellHost | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [remotePath, setRemotePath] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef('')

  const closeSession = (sid: string) => {
    if (!sid) return
    void api.closeSFTPSession(sid).catch(() => {})
  }

  const listDir = useCallback(async (sid: string, path: string) => {
    const list = await api.listSFTPDir(sid, path)
    setEntries(list)
    setRemotePath(path)
  }, [])

  const connect = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const h = await api.getShellHost(win.resourceId)
      setHost(h)
      if (h.kind === 'docker' && h.running === false) {
        throw new Error(t('sftp.containerStoppedHint', { name: h.name }))
      }
      const open = () => api.openSFTPSession(h.id)
      const info =
        h.kind === 'docker'
          ? await open()
          : await withSSHHostTrust(h.host || '', h.port || 22, open, confirmTrust)
      closeSession(sessionRef.current)
      sessionRef.current = info.sessionId
      setSessionId(info.sessionId)
      const home = await api.getSFTPHome(info.sessionId)
      await listDir(info.sessionId, home || '/')
    } catch (e) {
      setError((e as Error).message)
      sessionRef.current = ''
      setSessionId('')
      setEntries([])
    } finally {
      setBusy(false)
    }
  }, [confirmTrust, listDir, t, win.resourceId])

  useEffect(() => {
    void connect()
    return () => {
      closeSession(sessionRef.current)
      sessionRef.current = ''
    }
  }, [connect])

  const navigate = async (path: string) => {
    if (!sessionId) return
    setBusy(true)
    setError('')
    try {
      await listDir(sessionId, path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openEntry = (entry: FileEntry) => {
    if (!entry.isDir) return
    void navigate(entry.path)
  }

  if (error && !sessionId) {
    return (
      <div className="rw-surface rw-surface-sftp">
        {trustDialog}
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[
            { label: t('common.retry'), onPress: () => void connect(), primary: true },
            {
              label: t('resourceWindow.openInProduct'),
              onPress: () => openAsProduct({ kind: 'sftp', resourceId: win.resourceId, title: win.title }),
            },
          ]}
        />
      </div>
    )
  }

  if (!sessionId || (busy && entries.length === 0)) {
    return (
      <div className="rw-surface rw-surface-sftp rw-surface-loading">
        {trustDialog}
        <span>{busy ? t('sftp.connecting', { name: win.title }) : t('shell.loadingProduct')}</span>
        {!busy ? (
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void connect())}>
            {t('common.retry')}
          </button>
        ) : null}
      </div>
    )
  }

  const canUp = remotePath !== '/' && remotePath !== ''
  const sorted = [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return (
    <div className="rw-surface rw-surface-sftp">
      {trustDialog}
      <div className="rw-surface-toolbar">
        <span className="rw-surface-meta" title={remotePath}>
          {host?.name || win.title} · {remotePath}
        </span>
        <div className="rw-surface-toolbar-right">
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-tool"
            disabled={!canUp || busy}
            {...pressProps(() => void navigate(parentRemotePath(remotePath)))}
          >
            {t('resourceWindow.sftpParent')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-tool"
            disabled={busy}
            {...pressProps(() => void navigate(remotePath))}
          >
            {t('common.refresh')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-tool"
            {...pressProps(() =>
              openAsProduct({ kind: 'sftp', resourceId: win.resourceId, title: win.title }),
            )}
          >
            {t('resourceWindow.openInProduct')}
          </button>
        </div>
      </div>
      {error ? <p className="rw-surface-error">{error}</p> : null}
      <ul className="rw-sftp-list">
        {sorted.length === 0 ? (
          <li className="rw-surface-muted">{busy ? t('shell.loadingProduct') : t('resourceWindow.sftpEmpty')}</li>
        ) : (
          sorted.map((entry) => (
            <li key={entry.path} className={`rw-sftp-row${entry.isDir ? ' is-dir' : ''}`}>
              <button
                type="button"
                className="rw-sftp-main"
                disabled={!entry.isDir}
                {...pressProps(() => openEntry(entry))}
              >
                <span className="rw-sftp-name" title={entry.path}>
                  {entry.isDir ? `${entry.name}/` : entry.name}
                </span>
                <span className="rw-sftp-sub">
                  {entry.isDir ? t('sftp.remote') : formatBytes(entry.size)} · {formatModTime(entry.modTime)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'
import type { Connection, ObjectTreeNode } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { useI18n } from '../../../i18n'
import { openAsProduct } from '../openResource'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** DatabaseResourceSurface 轻量库面：连库、看表、跑一句 SQL；完整能力仍走产品线。 */
export function DatabaseResourceSurface({ window: win }: Props) {
  const { t } = useI18n()
  const [conn, setConn] = useState<Connection | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [tables, setTables] = useState<ObjectTreeNode[]>([])
  const [sql, setSql] = useState('SHOW TABLES')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef('')

  const closeSession = (sid: string) => {
    if (!sid) return
    void api.closeSession(sid).catch(() => {})
  }

  const connect = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const c = await api.getConnection(win.resourceId)
      setConn(c)
      const db = (c.database || '').trim()
      const info = await api.openSession(c.id, db)
      const sid = String((info as { sessionId?: string }).sessionId || '')
      if (!sid) throw new Error(t('resourceWindow.connectFailed'))
      closeSession(sessionRef.current)
      sessionRef.current = sid
      setSessionId(sid)
      const objs = db
        ? await api.listDatabaseObjects(sid, db)
        : ((await api.getObjectTree(sid)) as ObjectTreeNode[])
      setTables(objs.slice(0, 80))
      if (!db) setSql('SHOW DATABASES')
      else setSql(`SHOW TABLES`)
    } catch (e) {
      setError((e as Error).message)
      sessionRef.current = ''
      setSessionId('')
      setTables([])
    } finally {
      setBusy(false)
    }
  }, [t, win.resourceId])

  useEffect(() => {
    void connect()
    return () => {
      closeSession(sessionRef.current)
      sessionRef.current = ''
    }
  }, [connect])

  const runSql = async () => {
    if (!sessionId || !conn) return
    const text = sql.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      const db = (conn.database || '').trim()
      const raw = await api.executeSQL(sessionId, db, text)
      setResult(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))
    } catch (e) {
      setError((e as Error).message)
      setResult('')
    } finally {
      setBusy(false)
    }
  }

  if (error && !sessionId) {
    return (
      <div className="rw-surface rw-surface-db">
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[
            { label: t('common.retry'), onPress: () => void connect(), primary: true },
            {
              label: t('resourceWindow.openInProduct'),
              onPress: () => openAsProduct({ kind: 'database', resourceId: win.resourceId, title: win.title }),
            },
          ]}
        />
      </div>
    )
  }

  if (!sessionId || (busy && !conn)) {
    return (
      <div className="rw-surface rw-surface-db rw-surface-loading">
        <span>{busy ? t('shell.loadingProduct') : t('shell.loadingProduct')}</span>
      </div>
    )
  }

  return (
    <div className="rw-surface rw-surface-db">
      <div className="rw-surface-toolbar">
        <span className="rw-surface-meta" title={conn ? `${conn.host}:${conn.port}` : ''}>
          {conn
            ? `${conn.dbType} · ${conn.name}${conn.database ? ` / ${conn.database}` : ''}`
            : win.title}
        </span>
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-tool"
          {...pressProps(() =>
            openAsProduct({ kind: 'database', resourceId: win.resourceId, title: win.title }),
          )}
        >
          {t('resourceWindow.openInProduct')}
        </button>
      </div>
      <div className="rw-db-body">
        <aside className="rw-db-tables" aria-label={t('resourceWindow.dbTables')}>
          {tables.length === 0 ? (
            <p className="rw-surface-muted">{t('resourceWindow.dbTablesEmpty')}</p>
          ) : (
            <ul>
              {tables.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="rw-db-table-btn"
                    title={n.label}
                    {...pressProps(() => {
                      const table = n.table || n.label
                      const db = n.database || conn?.database || ''
                      setSql(db ? `SELECT * FROM \`${table}\` LIMIT 50` : `SHOW TABLES`)
                    })}
                  >
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="rw-db-main">
          <textarea
            className="rw-db-sql"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            rows={3}
          />
          <div className="rw-surface-toolbar">
            <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={busy} {...pressProps(() => void runSql())}>
              {t('resourceWindow.dbRun')}
            </button>
          </div>
          {error ? <p className="rw-surface-error">{error}</p> : null}
          <pre className="rw-db-result">{result || t('resourceWindow.dbResultEmpty')}</pre>
        </div>
      </div>
    </div>
  )
}

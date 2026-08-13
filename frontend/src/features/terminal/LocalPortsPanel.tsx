import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { LocalPortProcess } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { bindPointerAction } from '../../utils/pointerAction'

const QUICK_PORTS = [3000, 5173, 5174, 8080, 8000, 5432, 3306, 6379]

interface Props {
  onStatus: (msg: string) => void
}

/** LocalPortsPanel 本机端口占用查询与结束。 */
export function LocalPortsPanel({ onStatus }: Props) {
  const { t } = useI18n()
  const [portInput, setPortInput] = useState('')
  const [procs, setProcs] = useState<LocalPortProcess[]>([])
  const [mode, setMode] = useState<'idle' | 'port' | 'listen'>('idle')
  const [loading, setLoading] = useState(false)
  const [force, setForce] = useState(false)
  const [killTarget, setKillTarget] = useState<{ port: number; procs: LocalPortProcess[] } | null>(null)

  const loadByPort = useCallback(
    async (port: number) => {
      setLoading(true)
      try {
        const list = await api.listLocalPortProcesses(port)
        setProcs(list)
        setMode('port')
        setPortInput(String(port))
        if (list.length === 0) {
          onStatus(t('localPort.emptyPort', { port }))
        } else {
          onStatus(t('localPort.found', { port, count: list.length }))
        }
      } catch (e) {
        onStatus((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [onStatus, t],
  )

  const loadListening = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listListeningLocalPorts()
      setProcs(list)
      setMode('listen')
      if (list.length === 0) {
        onStatus(t('localPort.emptyListen'))
      } else {
        onStatus(t('localPort.listenFound', { count: list.length }))
      }
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [onStatus, t])

  useEffect(() => {
    void loadListening()
  }, [loadListening])

  const queryPort = () => {
    const port = Number(portInput.trim())
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      onStatus(t('localPort.errPort'))
      return
    }
    void loadByPort(port)
  }

  const askKill = (port: number, items: LocalPortProcess[]) => {
    if (!items.length) return
    setKillTarget({ port, procs: items })
  }

  const confirmKill = async () => {
    const target = killTarget
    setKillTarget(null)
    if (!target) return
    setLoading(true)
    try {
      const result = await api.killLocalPortProcesses(target.port, force)
      const names = result.killed.map((p) => p.name || `pid ${p.pid}`).join(', ')
      onStatus(
        force
          ? t('localPort.killedForce', { port: target.port, names })
          : t('localPort.killed', { port: target.port, names }),
      )
      if (mode === 'listen') {
        await loadListening()
      } else {
        await loadByPort(target.port)
      }
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const summary = (p: LocalPortProcess) => {
    const cmd = p.command?.trim() || p.name
    return cmd.length > 72 ? `${cmd.slice(0, 72)}…` : cmd
  }

  return (
    <>
      <section className="sidebar-section local-port-section">
        <div className="sidebar-header">
          <span>{t('localPort.title')}</span>
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={t('common.refresh')}
            disabled={loading}
            {...bindPointerAction(() => {
              if (mode === 'port' && portInput.trim()) {
                queryPort()
                return
              }
              void loadListening()
            })}
          >
            <IconRefresh size={14} />
          </button>
        </div>
        <div className="sidebar-body">
          <div className="local-port-query">
            <input
              className="wn-input wn-input-sm"
              type="number"
              min={1}
              max={65535}
              placeholder={t('localPort.portPlaceholder')}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') queryPort()
              }}
            />
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-primary"
              disabled={loading}
              {...bindPointerAction(queryPort)}
            >
              {t('localPort.query')}
            </button>
          </div>
          <div className="local-port-quick">
            {QUICK_PORTS.map((p) => (
              <button
                key={p}
                type="button"
                className="wn-btn wn-btn-xs wn-btn-ghost local-port-chip"
                disabled={loading}
                {...bindPointerAction(() => void loadByPort(p))}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="local-port-force">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span>{t('localPort.force')}</span>
          </label>
          <div className="ssh-forward-subhead">
            {mode === 'port' && portInput
              ? t('localPort.resultPort', { port: portInput })
              : t('localPort.listening')}
          </div>
          {procs.length === 0 ? (
            <div className="empty-hint">
              {loading ? t('localPort.loading') : t('localPort.emptyHint')}
            </div>
          ) : (
            <ul className="conn-list ssh-forward-list">
              {procs.map((p) => (
                <li key={`${p.pid}-${p.port}-${p.address}`} className="conn-item ssh-forward-item local-port-item">
                  <div className="conn-meta">
                    <span className="conn-name">
                      :{p.port} · {p.name || `pid ${p.pid}`}
                    </span>
                    <span className="conn-host" title={p.command || p.address}>
                      {summary(p)}
                    </span>
                    <span className="conn-host local-port-meta">
                      PID {p.pid}
                      {p.user ? ` · ${p.user}` : ''}
                      {p.address ? ` · ${p.address}` : ''}
                    </span>
                  </div>
                  <div className="ssh-forward-actions">
                    <button
                      type="button"
                      className="wn-btn wn-btn-xs wn-btn-ghost"
                      disabled={loading}
                      {...bindPointerAction(() => askKill(p.port, [p]))}
                    >
                      {t('localPort.kill')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {mode === 'port' && procs.length > 1 && (
            <button
              type="button"
              className="wn-btn wn-btn-xs wn-btn-ghost local-port-kill-all"
              disabled={loading}
              {...bindPointerAction(() => askKill(Number(portInput), procs))}
            >
              {t('localPort.killAll', { port: portInput })}
            </button>
          )}
          <div className="empty-hint mock-hint">{t('localPort.hint')}</div>
        </div>
      </section>

      <ConfirmDialog
        open={killTarget != null}
        title={t('localPort.killTitle')}
        message={
          killTarget
            ? t('localPort.killMsg', {
                port: killTarget.port,
                detail: killTarget.procs
                  .map((p) => `${p.name || 'process'} (PID ${p.pid})`)
                  .join(' · '),
                mode: force ? t('localPort.forceHint') : t('localPort.termHint'),
              })
            : undefined
        }
        confirmLabel={force ? t('localPort.killForce') : t('localPort.kill')}
        danger
        onConfirm={() => void confirmKill()}
        onCancel={() => setKillTarget(null)}
      />
    </>
  )
}

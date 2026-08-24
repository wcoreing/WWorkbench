import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { LocalPortProcess } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { ModalPortal, pressProps } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'
import { useLoading, withLoading } from '../../stores/loadingStore'

const LOCAL_PORT_LOADING = 'localPort.list'

const QUICK_PORTS = [3000, 5173, 5174, 8080, 8000, 5432, 3306, 6379]

interface Props {
  open: boolean
  onClose: () => void
  onStatus: (msg: string) => void
}

/** LocalPortsDialog 本机端口查询与结束（弹窗）。 */
export function LocalPortsDialog({ open, onClose, onStatus }: Props) {
  const { t } = useI18n()
  const [portInput, setPortInput] = useState('')
  const [procs, setProcs] = useState<LocalPortProcess[]>([])
  const [mode, setMode] = useState<'port' | 'listen'>('listen')
  const listLoading = useLoading(LOCAL_PORT_LOADING)
  const [force, setForce] = useState(false)
  const [killTarget, setKillTarget] = useState<{ port: number; procs: LocalPortProcess[] } | null>(null)

  const loadByPort = useCallback(
    async (port: number) => {
      try {
        await withLoading(
          LOCAL_PORT_LOADING,
          async () => {
            const list = await api.listLocalPortProcesses(port)
            setProcs(list)
            setMode('port')
            setPortInput(String(port))
            if (list.length === 0) {
              onStatus(t('localPort.emptyPort', { port }))
            } else {
              onStatus(t('localPort.found', { port, count: list.length }))
            }
          },
          {
            label: t('localPort.loading'),
            onBegin: () => setProcs([]),
          },
        )
      } catch (e) {
        onStatus((e as Error).message)
      }
    },
    [onStatus, t],
  )

  const loadListening = useCallback(async () => {
    try {
      await withLoading(
        LOCAL_PORT_LOADING,
        async () => {
          const list = await api.listListeningLocalPorts()
          setProcs(list)
          setMode('listen')
          if (list.length === 0) {
            onStatus(t('localPort.emptyListen'))
          } else {
            onStatus(t('localPort.listenFound', { count: list.length }))
          }
        },
        {
          label: t('localPort.loading'),
          onBegin: () => setProcs([]),
        },
      )
    } catch (e) {
      onStatus((e as Error).message)
    }
  }, [onStatus, t])

  useEffect(() => {
    if (!open) {
      setProcs([])
      setMode('listen')
      setPortInput('')
      return
    }
    void loadListening()
  }, [open, loadListening])

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
    setForce(false)
    setKillTarget({ port, procs: items })
  }

  const confirmKill = async () => {
    const target = killTarget
    const useForce = force
    setKillTarget(null)
    if (!target) return
    try {
      await withLoading(
        LOCAL_PORT_LOADING,
        async () => {
          const result = await api.killLocalPortProcesses(target.port, useForce)
          const names = result.killed.map((p) => p.name || `pid ${p.pid}`).join(', ')
          onStatus(
            useForce
              ? t('localPort.killedForce', { port: target.port, names })
              : t('localPort.killed', { port: target.port, names }),
          )
          if (mode === 'listen') {
            await loadListening()
          } else {
            await loadByPort(target.port)
          }
        },
        {
          label: t('localPort.loading'),
          onBegin: () => setProcs([]),
        },
      )
    } catch (e) {
      onStatus((e as Error).message)
    }
  }

  const rowTitle = (p: LocalPortProcess) => {
    const parts = [p.command || p.name, `PID ${p.pid}`, p.user || '', p.address || ''].filter(Boolean)
    return parts.join(' · ')
  }

  if (!open) return null

  return (
    <>
      <ModalPortal>
        <div className="wn-modal-backdrop wn-modal-backdrop-top" onClick={onClose}>
          <div
            className="wn-modal wn-modal-wide local-port-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="local-port-dialog-title"
          >
            <header className="wn-modal-header-bar">
              <h2 id="local-port-dialog-title" className="wn-modal-title">
                {t('localPort.title')}
              </h2>
              <div className="local-port-dialog-actions">
                <button
                  type="button"
                  className="wn-btn wn-btn-icon wn-btn-sm"
                  title={t('common.refresh')}
                  disabled={listLoading.active}
                  {...pressProps(() => {
                    if (mode === 'port' && portInput.trim()) {
                      queryPort()
                      return
                    }
                    void loadListening()
                  }, { disabled: listLoading.active })}
                >
                  <IconRefresh size={14} />
                </button>
                <button type="button" className="wn-modal-close-btn" {...pressProps(onClose)} aria-label={t('common.close')}>
                  ×
                </button>
              </div>
            </header>
            <div className="wn-modal-body local-port-dialog-body">
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
                  disabled={listLoading.active}
                  {...pressProps(queryPort, { disabled: listLoading.active })}
                >
                  {t('localPort.query')}
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-xs wn-btn-ghost"
                  disabled={listLoading.active}
                  {...pressProps(() => void loadListening(), { disabled: listLoading.active })}
                >
                  {t('localPort.listening')}
                </button>
              </div>
              <div className="local-port-quick">
                {QUICK_PORTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="wn-btn wn-btn-xs wn-btn-ghost local-port-chip"
                    disabled={listLoading.active}
                    {...pressProps(() => void loadByPort(p), { disabled: listLoading.active })}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="ssh-forward-subhead">
                {mode === 'port' && portInput
                  ? t('localPort.resultPort', { port: portInput })
                  : t('localPort.listening')}
                {procs.length > 0 ? ` · ${procs.length}` : ''}
              </div>
              <LoadingPane loadingKey={LOCAL_PORT_LOADING} label={t('localPort.loading')} minHeight={160}>
              {procs.length === 0 ? (
                <div className="empty-hint">{t('localPort.emptyHint')}</div>
              ) : (
                <ul className="conn-list local-port-list local-port-dialog-list">
                  {procs.map((p) => (
                    <li
                      key={`${p.pid}-${p.port}-${p.address}`}
                      className="conn-item local-port-item"
                      title={rowTitle(p)}
                    >
                      <span className="local-port-num">:{p.port}</span>
                      <span className="local-port-proc">{p.name || `pid ${p.pid}`}</span>
                      <span className="local-port-cmd">{p.command || p.address || ''}</span>
                      <button
                        type="button"
                        className="local-port-kill"
                        disabled={listLoading.active}
                        {...pressProps(() => askKill(p.port, [p]), { disabled: listLoading.active })}
                      >
                        {t('localPort.kill')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {mode === 'port' && procs.length > 1 && (
                <button
                  type="button"
                  className="wn-btn wn-btn-xs wn-btn-ghost local-port-kill-all"
                  disabled={listLoading.active}
                  {...pressProps(() => askKill(Number(portInput), procs), { disabled: listLoading.active })}
                >
                  {t('localPort.killAll', { port: portInput })}
                </button>
              )}
              </LoadingPane>
            </div>
          </div>
        </div>
      </ModalPortal>

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
      >
        <label className="local-port-force-dialog">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span>{t('localPort.force')}</span>
        </label>
      </ConfirmDialog>
    </>
  )
}

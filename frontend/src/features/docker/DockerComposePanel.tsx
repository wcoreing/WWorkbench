import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { ComposeService } from '../../api/types'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'

interface Props {
  contextId: string
  dockerReady: boolean
  projectDir: string
  onProjectDirChange: (dir: string) => void
  onStatus: (msg: string) => void
}

/** DockerComposePanel Compose 项目管理面板。 */
export function DockerComposePanel({ contextId, dockerReady, projectDir, onProjectDirChange, onStatus }: Props) {
  const { t } = useI18n()
  const [services, setServices] = useState<ComposeService[]>([])
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)

  const loadProjectDir = useCallback(async () => {
    try {
      const dir = await api.getDockerComposeDirectory(contextId)
      if (dir) onProjectDirChange(dir)
    } catch {
      /* 忽略 */
    }
  }, [contextId, onProjectDirChange])

  useEffect(() => {
    void loadProjectDir()
  }, [loadProjectDir])

  const refreshServices = useCallback(async () => {
    if (!dockerReady || !projectDir.trim()) return
    setLoading(true)
    try {
      const list = await api.listComposeServices(contextId, projectDir)
      setServices(list)
      setSelectedService((cur) => (cur && list.some((s) => s.service === cur) ? cur : list[0]?.service ?? null))
      onStatus(t('docker.composeLoaded', { count: list.length }))
    } catch (e) {
      setServices([])
      onStatus((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [contextId, projectDir, dockerReady, onStatus, t])

  const loadLogs = useCallback(
    async (service: string | null) => {
      if (!projectDir.trim()) return
      try {
        const content = await api.getComposeLogs(contextId, projectDir, service ?? '', 300)
        setLogs(content || t('docker.noLogs'))
      } catch (e) {
        setLogs((e as Error).message)
      }
    },
    [contextId, projectDir, t],
  )

  useEffect(() => {
    if (dockerReady && projectDir.trim()) void refreshServices()
  }, [contextId, projectDir, dockerReady, refreshServices])

  useEffect(() => {
    if (selectedService != null && projectDir) void loadLogs(selectedService)
  }, [selectedService, projectDir, loadLogs])

  const pickDir = async () => {
    try {
      const dir = await api.pickDockerComposeDirectory(contextId)
      if (dir) {
        onProjectDirChange(dir)
        onStatus(t('docker.composeDirSet', { path: dir }))
      }
    } catch (e) {
      onStatus((e as Error).message)
    }
  }

  const runAction = async (label: string, fn: () => Promise<string>) => {
    if (!projectDir.trim()) {
      onStatus(t('docker.composePickDir'))
      return
    }
    setActing(true)
    onStatus(label)
    try {
      const out = await fn()
      if (out) setLogs(out)
      await refreshServices()
      if (selectedService) await loadLogs(selectedService)
    } catch (e) {
      onStatus((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="docker-compose-panel">
      <div className="docker-compose-toolbar">
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-tool"
          disabled={acting}
          {...pressProps(() => void pickDir(), { disabled: acting })}
        >
          {t('docker.composePickDirBtn')}
        </button>
        <span className="docker-compose-path" title={projectDir}>
          {projectDir || t('docker.composeNoDir')}
        </span>
        <span className="chrome-spacer" />
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-primary"
          disabled={!dockerReady || acting || !projectDir}
          {...pressProps(
            () => void runAction(t('docker.composeStarting'), () => api.composeUp(contextId, projectDir)),
            { disabled: !dockerReady || acting || !projectDir },
          )}
        >
          {t('docker.composeUp')}
        </button>
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-tool"
          disabled={!dockerReady || acting || !projectDir}
          {...pressProps(
            () => void runAction(t('docker.composeStopping'), () => api.composeDown(contextId, projectDir)),
            { disabled: !dockerReady || acting || !projectDir },
          )}
        >
          {t('docker.composeDown')}
        </button>
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-tool"
          disabled={!dockerReady || acting || !projectDir}
          {...pressProps(
            () => void runAction(t('docker.composePulling'), () => api.composePull(contextId, projectDir)),
            { disabled: !dockerReady || acting || !projectDir },
          )}
        >
          {t('docker.composePull')}
        </button>
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-tool"
          disabled={!dockerReady || loading || acting || !projectDir}
          {...pressProps(() => void refreshServices(), {
            disabled: !dockerReady || loading || acting || !projectDir,
          })}
        >
          {t('common.refresh')}
        </button>
      </div>

      <div className="docker-compose-body">
        <div className="docker-table-wrap docker-table-full">
          <table className="docker-table">
            <thead>
              <tr>
                <th>{t('docker.colName')}</th>
                <th>{t('docker.colImage')}</th>
                <th>{t('docker.colState')}</th>
                <th>{t('docker.colPorts')}</th>
                <th className="docker-th-actions">{t('docker.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td colSpan={5} className="grid-empty">
                    {loading ? t('common.loading') : t('docker.composeNoServices')}
                  </td>
                </tr>
              ) : (
                services.map((s) => (
                  <tr
                    key={s.name || s.service}
                    className={`docker-row ${selectedService === s.service ? 'active' : ''}`}
                    {...pressProps(() => setSelectedService(s.service))}
                  >
                    <td>{s.service || s.name}</td>
                    <td className="docker-col-image">{s.image || '—'}</td>
                    <td>{s.state || s.status || '—'}</td>
                    <td>{s.ports || '—'}</td>
                    <td className="docker-td-actions">
                      <button
                        type="button"
                        className="wn-btn wn-btn-xs wn-btn-ghost"
                        disabled={acting}
                        {...pressProps(
                          () => {
                            void runAction(t('docker.composeRestarting', { name: s.service }), () =>
                              api.composeRestart(contextId, projectDir, s.service),
                            )
                          },
                          { disabled: acting, stop: true },
                        )}
                      >
                        {t('docker.restart')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="docker-compose-logs">
          <div className="docker-detail-tabs">
            <span className="docker-detail-tab active">{t('docker.tabLogs')}</span>
            {selectedService && <span className="docker-compose-log-service">{selectedService}</span>}
          </div>
          <pre className="docker-logs-pre">{logs || t('docker.selectComposeLogs')}</pre>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DockerContainer, DockerContext, LogSource, LogSourceType, SSHHost } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPlus, IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { loadLogsWorkspace, scheduleLogsWorkspacePersist } from '../../stores/logsWorkspacePersist'
import { model } from '../../../wailsjs/go/models'

const SOURCE_TYPES: LogSourceType[] = ['local_file', 'ssh_file', 'docker', 'compose']

const TYPE_LABEL_KEYS: Record<LogSourceType, string> = {
  local_file: 'logs.typeLocal',
  ssh_file: 'logs.typeSSH',
  docker: 'logs.typeDocker',
  compose: 'logs.typeCompose',
}

/** LogCenterWorkbench 日志中心工作区。 */
export function LogCenterWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [items, setItems] = useState<LogSource[]>([])
  const [activeId, setActiveId] = useState('')
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState<LogSourceType>('local_file')
  const [path, setPath] = useState('')
  const [sshHostId, setSSHHostId] = useState('')
  const [dockerContextId, setDockerContextId] = useState('')
  const [containerId, setContainerId] = useState('')
  const [composeDir, setComposeDir] = useState('')
  const [composeService, setComposeService] = useState('')
  const [tailLines, setTailLines] = useState(200)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LogSource | null>(null)
  const [sshHosts, setSSHHosts] = useState<SSHHost[]>([])
  const [dockerContexts, setDockerContexts] = useState<DockerContext[]>([])
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const workspaceLoaded = useRef(false)

  const loadEditor = useCallback((item: LogSource | null) => {
    if (!item) {
      setName('')
      setSourceType('local_file')
      setPath('')
      setSSHHostId('')
      setDockerContextId('')
      setContainerId('')
      setComposeDir('')
      setComposeService('')
      setTailLines(200)
      return
    }
    setName(item.name)
    setSourceType(item.sourceType)
    setPath(item.path)
    setSSHHostId(item.sshHostId)
    setDockerContextId(item.dockerContextId)
    setContainerId(item.containerId)
    setComposeDir(item.composeDir)
    setComposeService(item.composeService)
    setTailLines(item.tailLines > 0 ? item.tailLines : 200)
  }, [])

  const refreshList = useCallback(async () => {
    const list = (await api.listLogSources()) as LogSource[]
    setItems(list)
    return list
  }, [])

  useEffect(() => {
    void api.listSSHHosts().then((h) => setSSHHosts(h as SSHHost[])).catch(console.error)
    void api.listDockerContexts().then((c) => setDockerContexts(c as DockerContext[])).catch(console.error)
  }, [])

  useEffect(() => {
    if (sourceType !== 'docker' || !dockerContextId) {
      setContainers([])
      return
    }
    void api.listContainers(dockerContextId).then((c) => setContainers(c as DockerContainer[])).catch(() => setContainers([]))
  }, [sourceType, dockerContextId])

  useEffect(() => {
    if (workspaceLoaded.current) {
      void refreshList()
      return
    }
    workspaceLoaded.current = true
    void (async () => {
      const list = await refreshList()
      const snap = await loadLogsWorkspace()
      const id = snap?.activeId && list.some((x) => x.id === snap.activeId) ? snap.activeId : list[0]?.id ?? ''
      setActiveId(id)
      loadEditor(list.find((x) => x.id === id) ?? null)
    })()
  }, [refreshList, loadEditor])

  useEffect(() => {
    scheduleLogsWorkspacePersist({ version: 1, activeId })
  }, [activeId])

  const selectItem = (item: LogSource) => {
    setActiveId(item.id)
    loadEditor(item)
    setContent('')
  }

  const createNew = () => {
    setActiveId('')
    loadEditor(null)
    setContent('')
  }

  const refreshLogs = useCallback(async () => {
    if (!activeId) {
      setStatusMessage(t('logs.noOutput'))
      return
    }
    setLoading(true)
    setStatusMessage(t('logs.refreshing'))
    try {
      const res = await api.fetchLogSource(activeId, tailLines)
      setContent(res.content || '')
      setStatusMessage(t('logs.refresh'))
    } catch (e) {
      setContent((e as Error).message)
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeId, tailLines, setStatusMessage, t])

  useEffect(() => {
    if (!autoRefresh || !activeId) return
    const timer = window.setInterval(() => void refreshLogs(), 5000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, activeId, refreshLogs])

  const save = async () => {
    if (!name.trim()) {
      setStatusMessage(t('logs.errName'))
      return
    }
    const saved = (await api.saveLogSource(
      model.LogSourceDO.createFrom({
        id: activeId,
        name: name.trim(),
        sourceType,
        path: path.trim(),
        sshHostId,
        dockerContextId,
        containerId,
        composeDir: composeDir.trim(),
        composeService: composeService.trim(),
        tailLines,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    )) as LogSource
    setActiveId(saved.id)
    await refreshList()
    setStatusMessage(t('logs.saved'))
  }

  const pickComposeDir = async () => {
    if (!dockerContextId) return
    try {
      const dir = await api.pickDockerComposeDirectory(dockerContextId)
      if (dir) setComposeDir(dir)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  return (
    <div className="product-workbench logs-workbench">
      <header className="product-toolbar">
        <div className="product-actions">
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            disabled={loading || !activeId}
            onClick={() => void refreshLogs()}
          >
            <IconRefresh size={14} /> {t('logs.refresh')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => void save()}>
            {t('logs.save')}
          </button>
          <label className="logs-auto-label">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} disabled={!activeId} />
            {t('logs.autoRefresh')}
          </label>
        </div>
      </header>

      <div className="product-body">
        <aside className="app-sidebar logs-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('products.logs.label')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('logs.newSource')} onClick={createNew}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {items.length === 0 ? (
                <div className="empty-hint">{t('logs.emptyList')}</div>
              ) : (
                <ul className="conn-list">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`conn-item ${item.id === activeId ? 'active' : ''}`}
                      onClick={() => selectItem(item)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setDeleteTarget(item)
                      }}
                    >
                      <div className="conn-meta">
                        <span className="conn-name">{item.name}</span>
                        <span className="conn-host">{t(TYPE_LABEL_KEYS[item.sourceType])}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <main className="app-main logs-main">
          <div className="logs-config">
            <div className="logs-row logs-row-2">
              <div className="logs-field">
                <label className="wn-label">{t('logs.name')}</label>
                <input className="wn-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('logs.namePlaceholder')} />
              </div>
              <div className="logs-field logs-field-narrow">
                <label className="wn-label">{t('logs.tailLines')}</label>
                <input
                  className="wn-input"
                  type="number"
                  min={10}
                  max={5000}
                  value={tailLines}
                  onChange={(e) => setTailLines(Number(e.target.value) || 200)}
                />
              </div>
            </div>
            <div className="logs-row">
              <label className="wn-label">{t('logs.sourceType')}</label>
              <select className="wn-input" value={sourceType} onChange={(e) => setSourceType(e.target.value as LogSourceType)}>
                {SOURCE_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(TYPE_LABEL_KEYS[ty])}
                  </option>
                ))}
              </select>
            </div>

            {sourceType === 'local_file' && (
              <div className="logs-row">
                <label className="wn-label">{t('logs.path')}</label>
                <input className="wn-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('logs.pathPlaceholder')} />
              </div>
            )}

            {sourceType === 'ssh_file' && (
              <>
                <div className="logs-row">
                  <label className="wn-label">{t('logs.sshHost')}</label>
                  <select className="wn-input" value={sshHostId} onChange={(e) => setSSHHostId(e.target.value)}>
                    <option value="">{t('logs.selectHost')}</option>
                    {sshHosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.host})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="logs-row">
                  <label className="wn-label">{t('logs.path')}</label>
                  <input className="wn-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('logs.pathPlaceholder')} />
                </div>
              </>
            )}

            {(sourceType === 'docker' || sourceType === 'compose') && (
              <div className="logs-row">
                <label className="wn-label">{t('logs.dockerContext')}</label>
                <select className="wn-input" value={dockerContextId} onChange={(e) => setDockerContextId(e.target.value)}>
                  <option value="">{t('logs.selectContext')}</option>
                  {dockerContexts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {sourceType === 'docker' && (
              <div className="logs-row">
                <label className="wn-label">{t('logs.container')}</label>
                <select className="wn-input" value={containerId} onChange={(e) => setContainerId(e.target.value)}>
                  <option value="">{t('logs.selectContainer')}</option>
                  {containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.image})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {sourceType === 'compose' && (
              <>
                <div className="logs-row logs-row-compose-dir">
                  <label className="wn-label">{t('logs.composeDir')}</label>
                  <input
                    className="wn-input"
                    value={composeDir}
                    onChange={(e) => setComposeDir(e.target.value)}
                    placeholder={t('logs.composeDirPlaceholder')}
                  />
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => void pickComposeDir()}>
                    {t('logs.pickComposeDir')}
                  </button>
                </div>
                <div className="logs-row">
                  <label className="wn-label">{t('logs.composeService')}</label>
                  <input
                    className="wn-input"
                    value={composeService}
                    onChange={(e) => setComposeService(e.target.value)}
                    placeholder={t('logs.composeServicePlaceholder')}
                  />
                </div>
              </>
            )}
          </div>

          <div className="logs-viewer">
            <header className="logs-viewer-head">
              <span className="wn-label">{t('logs.logOutput')}</span>
            </header>
            {!content && !loading ? (
              <div className="pane-empty">{t('logs.noOutput')}</div>
            ) : (
              <pre className="logs-pre">{loading && !content ? t('logs.refreshing') : content}</pre>
            )}
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('logs.deleteTitle')}
        message={deleteTarget ? t('logs.deleteMsg', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          const item = deleteTarget
          setDeleteTarget(null)
          if (!item) return
          void api.deleteLogSource(item.id).then(async () => {
            if (activeId === item.id) {
              setActiveId('')
              loadEditor(null)
              setContent('')
            }
            await refreshList()
            setStatusMessage(t('logs.deleted'))
          })
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

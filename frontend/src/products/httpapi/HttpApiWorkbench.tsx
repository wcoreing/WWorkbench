import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { HTTPEnvironment, HTTPHeaderKV, HTTPResponse, HTTPSavedRequest } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPlay, IconPlus } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import {
  loadHttpApiWorkspace,
  scheduleHttpApiWorkspacePersist,
} from '../../stores/httpapiWorkspacePersist'
import { model } from '../../../wailsjs/go/models'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const

/** parseHeaderText 解析「Key: value」多行请求头。 */
function parseHeaderText(text: string): HTTPHeaderKV[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':')
      if (i < 0) return { key: line, value: '' }
      return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }
    })
    .filter((h) => h.key)
}

/** formatHeaderText 格式化请求头为多行文本。 */
function formatHeaderText(headers: HTTPHeaderKV[]): string {
  return headers.map((h) => `${h.key}: ${h.value}`).join('\n')
}

/** parseHeadersJson 解析存储的 JSON 请求头。 */
function parseHeadersJson(json: string): HTTPHeaderKV[] {
  try {
    const arr = JSON.parse(json || '[]') as HTTPHeaderKV[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** parseEnvText 解析 key=value 环境变量文本。 */
function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    if (key) out[key] = t.slice(i + 1).trim()
  }
  return out
}

/** formatEnvText 将环境变量 JSON 格式化为 key=value 多行。 */
function formatEnvText(json: string): string {
  try {
    const m = JSON.parse(json || '{}') as Record<string, string>
    if (!m || typeof m !== 'object') return ''
    return Object.entries(m)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  } catch {
    return ''
  }
}

/** HttpApiWorkbench HTTP API 调试工作区。 */
export function HttpApiWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [items, setItems] = useState<HTTPSavedRequest[]>([])
  const [activeId, setActiveId] = useState('')
  const [name, setName] = useState('')
  const [method, setMethod] = useState<string>('GET')
  const [url, setUrl] = useState('')
  const [headerText, setHeaderText] = useState('')
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<HTTPResponse | null>(null)
  const [sending, setSending] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HTTPSavedRequest | null>(null)

  const [envs, setEnvs] = useState<HTTPEnvironment[]>([])
  const [activeEnvId, setActiveEnvId] = useState('')
  const [selectedEnvId, setSelectedEnvId] = useState('')
  const [envName, setEnvName] = useState('')
  const [envVarText, setEnvVarText] = useState('')
  const [deleteEnvTarget, setDeleteEnvTarget] = useState<HTTPEnvironment | null>(null)

  const workspaceLoaded = useRef(false)

  const loadEditor = useCallback((item: HTTPSavedRequest | null) => {
    if (!item) {
      setName('')
      setMethod('GET')
      setUrl('')
      setHeaderText('')
      setBody('')
      return
    }
    setName(item.name)
    setMethod(item.method || 'GET')
    setUrl(item.url)
    setHeaderText(formatHeaderText(parseHeadersJson(item.headersJson)))
    setBody(item.body)
  }, [])

  const loadEnvEditor = useCallback((item: HTTPEnvironment | null) => {
    if (!item) {
      setSelectedEnvId('')
      setEnvName('')
      setEnvVarText('')
      return
    }
    setSelectedEnvId(item.id)
    setEnvName(item.name)
    setEnvVarText(formatEnvText(item.varsJson))
  }, [])

  const refreshList = useCallback(async () => {
    const list = (await api.listHTTPRequests()) as HTTPSavedRequest[]
    setItems(list)
    return list
  }, [])

  const refreshEnvs = useCallback(async () => {
    const list = (await api.listHTTPEnvironments()) as HTTPEnvironment[]
    setEnvs(list)
    return list
  }, [])

  useEffect(() => {
    if (workspaceLoaded.current) {
      void refreshList()
      void refreshEnvs()
      return
    }
    workspaceLoaded.current = true
    void (async () => {
      const [list, envList] = await Promise.all([refreshList(), refreshEnvs()])
      const snap = await loadHttpApiWorkspace()
      const id = snap?.activeId && list.some((x) => x.id === snap.activeId) ? snap.activeId : list[0]?.id ?? ''
      setActiveId(id)
      loadEditor(list.find((x) => x.id === id) ?? null)

      const envId =
        snap?.activeEnvId && envList.some((x) => x.id === snap.activeEnvId) ? snap.activeEnvId : ''
      setActiveEnvId(envId)
      const env = envList.find((x) => x.id === envId)
      if (env) loadEnvEditor(env)
    })()
  }, [refreshList, refreshEnvs, loadEditor, loadEnvEditor])

  useEffect(() => {
    scheduleHttpApiWorkspacePersist({ version: 2, activeId, activeEnvId })
  }, [activeId, activeEnvId])

  const selectItem = (item: HTTPSavedRequest) => {
    setActiveId(item.id)
    loadEditor(item)
    setResponse(null)
  }

  const createNew = () => {
    setActiveId('')
    loadEditor(null)
    setResponse(null)
  }

  const selectEnv = (item: HTTPEnvironment) => {
    loadEnvEditor(item)
  }

  const createNewEnv = () => {
    loadEnvEditor(null)
  }

  const buildExecuteReq = () =>
    model.HTTPExecuteRequestDO.createFrom({
      method,
      url: url.trim(),
      headers: parseHeaderText(headerText),
      body,
      timeoutMs: 30000,
      envId: activeEnvId,
    })

  const send = async () => {
    if (!url.trim()) {
      setStatusMessage(t('httpapi.errUrl'))
      return
    }
    setSending(true)
    setStatusMessage(t('httpapi.sending'))
    try {
      const res = (await api.executeHTTPRequest(buildExecuteReq())) as HTTPResponse
      setResponse(res)
      setStatusMessage(
        res.error
          ? res.error
          : `${res.statusCode} ${res.status} · ${t('httpapi.elapsed', { ms: res.elapsedMs })}`,
      )
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const save = async () => {
    if (!name.trim()) {
      setStatusMessage(t('httpapi.errName'))
      return
    }
    if (!url.trim()) {
      setStatusMessage(t('httpapi.errUrl'))
      return
    }
    const headers = parseHeaderText(headerText)
    const saved = (await api.saveHTTPRequest(
      model.HTTPSavedRequestDO.createFrom({
        id: activeId,
        name: name.trim(),
        method,
        url: url.trim(),
        headersJson: JSON.stringify(headers),
        body,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    )) as HTTPSavedRequest
    setActiveId(saved.id)
    await refreshList()
    setStatusMessage(t('httpapi.saved'))
  }

  const saveEnv = async () => {
    if (!envName.trim()) {
      setStatusMessage(t('httpapi.errEnvName'))
      return
    }
    const saved = (await api.saveHTTPEnvironment(
      model.HTTPEnvironmentDO.createFrom({
        id: selectedEnvId,
        name: envName.trim(),
        varsJson: JSON.stringify(parseEnvText(envVarText)),
        createdAt: 0,
        updatedAt: 0,
      }),
    )) as HTTPEnvironment
    setSelectedEnvId(saved.id)
    await refreshEnvs()
    setStatusMessage(t('httpapi.envSaved'))
  }

  return (
    <div className="product-workbench httpapi-workbench">
      <header className="product-toolbar">
        <div className="product-actions">
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={sending} onClick={() => void send()}>
            <IconPlay size={14} /> {t('httpapi.send')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => void save()}>
            {t('httpapi.save')}
          </button>
        </div>
      </header>

      <div className="product-body">
        <aside className="app-sidebar httpapi-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('products.httpapi.label')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('httpapi.newRequest')} onClick={createNew}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {items.length === 0 ? (
                <div className="empty-hint">{t('httpapi.emptyList')}</div>
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
                        <span className="conn-host">
                          {item.method} {item.url}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('httpapi.envSection')}</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('httpapi.newEnv')} onClick={createNewEnv}>
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {envs.length === 0 ? (
                <div className="empty-hint">{t('httpapi.emptyEnvList')}</div>
              ) : (
                <ul className="conn-list">
                  {envs.map((item) => (
                    <li
                      key={item.id}
                      className={`conn-item ${item.id === selectedEnvId ? 'active' : ''}`}
                      onClick={() => selectEnv(item)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setDeleteEnvTarget(item)
                      }}
                    >
                      <div className="conn-meta">
                        <span className="conn-name">{item.name}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <main className="app-main httpapi-main">
          <div className="httpapi-request">
            <div className="httpapi-env-bar">
              <label className="wn-label httpapi-env-active">
                {t('httpapi.activeEnv')}
                <select
                  className="wn-input"
                  value={activeEnvId}
                  onChange={(e) => setActiveEnvId(e.target.value)}
                >
                  <option value="">{t('httpapi.noEnv')}</option>
                  {envs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="httpapi-env-editor">
                <div className="httpapi-row" style={{ gap: 8 }}>
                  <input
                    className="wn-input"
                    value={envName}
                    onChange={(e) => setEnvName(e.target.value)}
                    placeholder={t('httpapi.envNamePlaceholder')}
                  />
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => void saveEnv()}>
                    {t('httpapi.saveEnv')}
                  </button>
                </div>
                <textarea
                  className="wn-input httpapi-textarea httpapi-env-vars"
                  value={envVarText}
                  onChange={(e) => setEnvVarText(e.target.value)}
                  placeholder={t('httpapi.envVarsPlaceholder')}
                  spellCheck={false}
                />
                <span className="httpapi-env-hint">{t('httpapi.envVarsHint')}</span>
              </div>
            </div>

            <div className="httpapi-row">
              <label className="wn-label">{t('httpapi.name')}</label>
              <input className="wn-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('httpapi.namePlaceholder')} />
            </div>
            <div className="httpapi-row httpapi-method-url">
              <select className="wn-input httpapi-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input className="wn-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('httpapi.urlPlaceholder')} />
            </div>
            <div className="httpapi-split">
              <div className="httpapi-field">
                <label className="wn-label">{t('httpapi.headers')}</label>
                <textarea
                  className="wn-input httpapi-textarea"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t('httpapi.headersPlaceholder')}
                  spellCheck={false}
                />
              </div>
              <div className="httpapi-field">
                <label className="wn-label">{t('httpapi.body')}</label>
                <textarea
                  className="wn-input httpapi-textarea"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('httpapi.bodyPlaceholder')}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          <div className="httpapi-response">
            <div className="httpapi-response-head">
              <span className="wn-label">{t('httpapi.response')}</span>
              {response && !response.error && (
                <>
                  <span className="httpapi-status">
                    {t('httpapi.status')}: {response.statusCode} {response.status}
                  </span>
                  <span className="httpapi-status">{t('httpapi.elapsed', { ms: response.elapsedMs })}</span>
                  <button
                    type="button"
                    className="wn-btn wn-btn-xs wn-btn-ghost"
                    onClick={() => void navigator.clipboard.writeText(response.body).then(() => setStatusMessage(t('httpapi.copied')))}
                  >
                    {t('httpapi.copyBody')}
                  </button>
                </>
              )}
            </div>
            {!response ? (
              <div className="pane-empty">{t('httpapi.noResponse')}</div>
            ) : (
              <div className="httpapi-response-body">
                {response.headers?.length > 0 && (
                  <pre className="httpapi-pre httpapi-headers-pre">
                    {response.headers.map((h) => `${h.key}: ${h.value}`).join('\n')}
                  </pre>
                )}
                <pre className="httpapi-pre">{response.body || response.error}</pre>
              </div>
            )}
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('httpapi.deleteTitle')}
        message={deleteTarget ? t('httpapi.deleteMsg', { name: deleteTarget.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          const item = deleteTarget
          setDeleteTarget(null)
          if (!item) return
          void api.deleteHTTPRequest(item.id).then(async () => {
            if (activeId === item.id) {
              setActiveId('')
              loadEditor(null)
            }
            await refreshList()
            setStatusMessage(t('httpapi.deleted'))
          })
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={deleteEnvTarget != null}
        title={t('httpapi.deleteEnvTitle')}
        message={deleteEnvTarget ? t('httpapi.deleteEnvMsg', { name: deleteEnvTarget.name }) : undefined}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          const item = deleteEnvTarget
          setDeleteEnvTarget(null)
          if (!item) return
          void api.deleteHTTPEnvironment(item.id).then(async () => {
            if (activeEnvId === item.id) setActiveEnvId('')
            if (selectedEnvId === item.id) loadEnvEditor(null)
            await refreshEnvs()
            setStatusMessage(t('httpapi.envDeleted'))
          })
        }}
        onCancel={() => setDeleteEnvTarget(null)}
      />
    </div>
  )
}

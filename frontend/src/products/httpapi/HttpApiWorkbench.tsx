import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { HTTPEnvironment, HTTPFolder, HTTPResponse, HTTPSavedRequest } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { IconPlay } from '../../components/Icons'
import { ResizeHandle } from '../../components/layout'
import { openAgentDraft, mentionHttpRequest } from '../../features/agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildHttpApiSurface, briefList } from '../../stores/agentSurface'
import { useWorkbenchCommand } from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { payloadStr } from '../../workbench/commandPayload'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { Select, pressProps, useDismissOverlays } from '../../components/compat'
import {
  loadHttpApiWorkspace,
  scheduleHttpApiWorkspacePersist,
} from '../../stores/httpapiWorkspacePersist'
import { model } from '../../../wailsjs/go/models'
import { HttpApiContextMenu, type HttpApiContextMenuState } from './HttpApiContextMenu'
import { HttpApiSidebar } from './HttpApiSidebar'
import { persistHttpTreeDrop } from './httpapiMove'
import { nextHttpChildSortOrder } from './httpapiSort'
import type { HttpDragPayload, HttpDropTarget } from './httpapiSort'
import { HttpEnvModal } from './HttpEnvModal'
import { HttpKeyValueTable } from './HttpKeyValueTable'
import {
  type HttpAuthMode,
  type HttpBodyMode,
  type HttpKVRow,
  applyAuthHeader,
  applyBodyModeHeaders,
  buildFormBody,
  buildUrlWithParams,
  detectBodyMode,
  emptyKVRow,
  extractBearerToken,
  extractCookieRows,
  formatBodySize,
  headersToKVRows,
  kvRowsToHeaders,
  mergeCookieHeader,
  methodAllowsBody,
  parseCurlCommand,
  parseKVJson,
  parseQueryString,
  prettyPrintBody,
  serializeKVRows,
  splitUrlBaseAndQuery,
  statusTone,
  toCurlCommand,
  nextUntitledHttpName,
} from './httpUtils'

const NEW_REQUEST_DEFAULT_URL = 'http://localhost'
import { historyFromResponse, loadHttpHistory, pushHttpHistory, type HttpHistoryEntry } from './httpHistory'
import { clearHttpStash, loadHttpStash, saveHttpStash } from './httpStash'
import { useHttpSplitResize } from './useHttpSplitResize'
import { useHttpDiscardConfirm } from './useHttpDiscardConfirm'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const TIMEOUTS = [5000, 15000, 30000, 60000, 120000] as const

type RequestTab = 'params' | 'body' | 'headers' | 'cookies' | 'auth'
type ResponseTab = 'body' | 'cookie' | 'header' | 'actual'

/** HttpApiWorkbench HTTP API 工作区（Apifox 式布局与交互）。 */
export function HttpApiWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const { hostRef, ratio, onResizeStart } = useHttpSplitResize()

  const [folders, setFolders] = useState<HTTPFolder[]>([])
  const [items, setItems] = useState<HTTPSavedRequest[]>([])
  const [filter, setFilter] = useState('')
  const [activeId, setActiveId] = useState('')
  const [folderId, setFolderId] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [method, setMethod] = useState<string>('GET')
  const [urlBase, setUrlBase] = useState('')
  const [paramRows, setParamRows] = useState<HttpKVRow[]>([emptyKVRow()])
  const [headerRows, setHeaderRows] = useState<HttpKVRow[]>([emptyKVRow()])
  const [cookieRows, setCookieRows] = useState<HttpKVRow[]>([emptyKVRow()])
  const [formRows, setFormRows] = useState<HttpKVRow[]>([emptyKVRow()])
  const [body, setBody] = useState('')
  const [bodyMode, setBodyMode] = useState<HttpBodyMode>('none')
  const [authMode, setAuthMode] = useState<HttpAuthMode>('none')
  const [authToken, setAuthToken] = useState('')
  const [timeoutMs, setTimeoutMs] = useState<number>(30000)
  const [reqTab, setReqTab] = useState<RequestTab>('params')
  const [resTab, setResTab] = useState<ResponseTab>('body')
  const [prettyResponse, setPrettyResponse] = useState(true)

  const [response, setResponse] = useState<HTTPResponse | null>(null)
  const [lastSentCurl, setLastSentCurl] = useState('')
  const [sending, setSending] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<HTTPSavedRequest | null>(null)
  const [ctxMenu, setCtxMenu] = useState<HttpApiContextMenuState | null>(null)
  const [envModalOpen, setEnvModalOpen] = useState(false)
  useDismissOverlays(() => setCtxMenu(null))
  const [curlOpen, setCurlOpen] = useState(false)
  const [curlText, setCurlText] = useState('')
  const [history, setHistory] = useState<HttpHistoryEntry[]>(() => loadHttpHistory())
  const [historyOpen, setHistoryOpen] = useState(false)

  const [envs, setEnvs] = useState<HTTPEnvironment[]>([])
  const [activeEnvId, setActiveEnvId] = useState('')

  const workspaceLoaded = useRef(false)
  const dirtyRef = useRef(false)
  const { discardOpen, runWithDiscardCheck, confirmDiscard, cancelDiscard } = useHttpDiscardConfirm(dirtyRef)

  const stashSlot = activeId || '__draft__'

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

  const refreshFolders = useCallback(async () => {
    const list = (await api.listHTTPFolders()) as HTTPFolder[]
    setFolders(list)
    return list
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshList(), refreshEnvs(), refreshFolders()])
  }, [refreshList, refreshEnvs, refreshFolders])

  const loadEditor = useCallback((item: HTTPSavedRequest | null) => {
    dirtyRef.current = false
    if (!item) {
      setName('')
      setNotes('')
      setMethod('GET')
      setUrlBase('')
      setParamRows([emptyKVRow()])
      setHeaderRows([emptyKVRow()])
      setCookieRows([emptyKVRow()])
      setFormRows([emptyKVRow()])
      setBody('')
      setBodyMode('none')
      setAuthMode('none')
      setAuthToken('')
      return
    }
    const params = parseKVJson(item.paramsJson || '[]')
    const cookies = parseKVJson(item.cookiesJson || '[]')
    let headers = headersToKVRows(parseKVJson(item.headersJson || '[]'))
    let cookieList = cookies.length ? cookies : [emptyKVRow()]
    if (!cookies.length) {
      const split = extractCookieRows(headers)
      headers = split.headers
      cookieList = split.cookies
    }
    const { base, query } = splitUrlBaseAndQuery(item.url)
    const paramFromUrl = query ? parseQueryString(query) : params
    const auth = extractBearerToken(headers)
    const mode = detectBodyMode(item.body, kvRowsToHeaders(headers))
    setFolderId(item.folderId || '')
    setName(item.name)
    setNotes(item.notes || '')
    setMethod(item.method || 'GET')
    setUrlBase(base)
    setParamRows(paramFromUrl.length ? paramFromUrl : [emptyKVRow()])
    setHeaderRows(headers)
    setCookieRows(cookieList)
    setBody(item.body)
    setBodyMode(mode)
    if (mode === 'form' && item.body) setFormRows(parseQueryString(item.body.replace(/^\?/, '')))
    else setFormRows([emptyKVRow()])
    setAuthMode(auth.mode)
    setAuthToken(auth.token)
  }, [])

  useEffect(() => {
    if (workspaceLoaded.current) {
      void refreshAll()
      return
    }
    workspaceLoaded.current = true
    void (async () => {
      const list = await refreshList()
      const envList = await refreshEnvs()
      await refreshFolders()
      const snap = await loadHttpApiWorkspace()
      let id = list[0]?.id ?? ''
      if (snap) {
        if (snap.activeId === '' || list.some((x) => x.id === snap.activeId)) {
          id = snap.activeId
        }
      }
      setActiveId(id)
      loadEditor(list.find((x) => x.id === id) ?? null)
      setActiveEnvId(snap?.activeEnvId && envList.some((x) => x.id === snap.activeEnvId) ? snap.activeEnvId : '')
    })()
  }, [refreshAll, loadEditor])

  useEffect(() => {
    scheduleHttpApiWorkspacePersist({ version: 2, activeId, activeEnvId })
  }, [activeId, activeEnvId])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.wn-context-menu')) return
      setCtxMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const markDirty = () => {
    dirtyRef.current = true
  }

  const resolveBody = (): string => {
    if (!methodAllowsBody(method) || bodyMode === 'none') return ''
    if (bodyMode === 'form') return buildFormBody(formRows)
    return body
  }

  const mergedHeaders = useCallback(() => {
    let rows = [...headerRows]
    rows = applyBodyModeHeaders(rows, bodyMode)
    rows = applyAuthHeader(rows, authMode, authToken)
    rows = mergeCookieHeader(rows, cookieRows)
    return kvRowsToHeaders(rows)
  }, [headerRows, bodyMode, authMode, authToken, cookieRows])

  const fullUrl = useCallback(
    () => buildUrlWithParams(urlBase.trim(), paramRows),
    [urlBase, paramRows],
  )

  useEffect(() => {
    if (activeProduct !== 'httpapi') return
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    const env = activeEnvId ? envs.find((e) => e.id === activeEnvId) : undefined
    setAgentSurface(
      buildHttpApiSurface({
        requestId: activeId || undefined,
        name,
        method,
        url: fullUrl(),
        folderLabel: folder?.name,
        envLabel: env?.name,
        openTabsBrief: briefList(
          items.slice(0, 12).map((i) => `${i.method} ${i.name}`),
          12,
        ),
      }),
    )
  }, [
    activeProduct,
    activeId,
    name,
    method,
    folderId,
    folders,
    activeEnvId,
    envs,
    items,
    fullUrl,
    setAgentSurface,
  ])

  useEffect(() => {
    const apply = async (evt: WorkbenchChangedEvent) => {
      if (!evt.domain.startsWith('http.')) return
      if (evt.domain === 'http.env') {
        await refreshEnvs()
        return
      }
      if (evt.domain === 'http.folder') {
        await refreshFolders()
        await refreshList()
        return
      }
      const list = await refreshList()
      await refreshFolders()
      const revealId = evt.reveal ? evt.ids[0] : ''
      if (revealId) {
        const item = list.find((x) => x.id === revealId)
        if (item) {
          setActiveId(item.id)
          loadEditor(item)
        }
        const tip = evt.label || revealId
        useAppStore.getState().setStatusMessage(
          evt.op === 'delete' ? `资产已删除：${tip}` : `已落 HTTP 资产：${tip}`,
        )
      }
    }
    const pending = takePendingWorkbenchChanged('http.')
    for (const evt of pending) void apply(evt)
    return subscribeWorkbenchChanged((evt) => {
      void apply(evt)
    })
  }, [refreshList, refreshEnvs, refreshFolders, loadEditor])

  const buildExecuteReq = useCallback(
    () =>
      model.HTTPExecuteRequestDO.createFrom({
        method,
        url: fullUrl(),
        headers: mergedHeaders(),
        body: resolveBody(),
        timeoutMs,
        envId: activeEnvId,
      }),
    [method, fullUrl, mergedHeaders, timeoutMs, activeEnvId, body, bodyMode, formRows],
  )

  const send = async () => {
    const url = fullUrl()
    if (!url.trim()) {
      setStatusMessage(t('httpapi.errUrl'))
      return
    }
    const req = buildExecuteReq()
    const curl = toCurlCommand({
      method,
      url,
      headers: mergedHeaders(),
      body: resolveBody(),
    })
    setLastSentCurl(curl)
    setSending(true)
    setStatusMessage(t('httpapi.sending'))
    try {
      const res = (await api.executeHTTPRequest(req)) as HTTPResponse
      setResponse(res)
      setResTab('body')
      setHistory(pushHttpHistory(historyFromResponse(method, url, name, res)))
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
    const url = fullUrl()
    if (!url.trim()) {
      setStatusMessage(t('httpapi.errUrl'))
      return
    }
    const headers = mergedHeaders().filter((h) => h.key.toLowerCase() !== 'cookie')
    try {
      const saved = (await api.saveHTTPRequest(
        model.HTTPSavedRequestDO.createFrom({
          id: activeId,
          folderId,
          name: name.trim(),
          method,
          url,
          paramsJson: serializeKVRows(paramRows),
          headersJson: JSON.stringify(headers),
          cookiesJson: serializeKVRows(cookieRows),
          body: resolveBody(),
          notes: notes.trim(),
          sortOrder: activeId
            ? (items.find((i) => i.id === activeId)?.sortOrder ?? 0)
            : nextHttpChildSortOrder(folders, items, folderId),
          createdAt: 0,
          updatedAt: 0,
        }),
      )) as HTTPSavedRequest
      setActiveId(saved.id)
      dirtyRef.current = false
      clearHttpStash(stashSlot)
      await refreshList()
      setStatusMessage(t('httpapi.saved'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const stash = () => {
    saveHttpStash(stashSlot, {
      name,
      notes,
      method,
      urlBase,
      paramsJson: serializeKVRows(paramRows),
      headersJson: serializeKVRows(headerRows),
      cookiesJson: serializeKVRows(cookieRows),
      body,
      bodyMode,
      authMode,
      authToken,
    })
    setStatusMessage(t('httpapi.stashed'))
  }

  const loadStashToEditor = () => {
    const s = loadHttpStash(stashSlot)
    if (!s) {
      setStatusMessage(t('httpapi.noStash'))
      return
    }
    setName(s.name)
    setNotes(s.notes)
    setMethod(s.method)
    setUrlBase(s.urlBase)
    setParamRows(parseKVJson(s.paramsJson))
    setHeaderRows(parseKVJson(s.headersJson))
    setCookieRows(parseKVJson(s.cookiesJson))
    setBody(s.body)
    setBodyMode(s.bodyMode as HttpBodyMode)
    setAuthMode(s.authMode as HttpAuthMode)
    setAuthToken(s.authToken)
    markDirty()
    setStatusMessage(t('httpapi.stashLoaded'))
  }

  const duplicate = () => {
    setActiveId('')
    setName(name ? `${name} (${t('httpapi.copySuffix')})` : '')
    markDirty()
    setStatusMessage(t('httpapi.duplicatedDraft'))
  }

  const exportCurl = () => {
    const url = fullUrl()
    if (!url.trim()) {
      setStatusMessage(t('httpapi.errUrl'))
      return
    }
    const curl = toCurlCommand({
      method,
      url,
      headers: mergedHeaders(),
      body: resolveBody(),
    })
    void navigator.clipboard
      .writeText(curl)
      .then(() => setStatusMessage(t('httpapi.curlCopied')))
      .catch((e) => setStatusMessage((e as Error).message))
  }

  const importCurl = () => {
    const parsed = parseCurlCommand(curlText)
    if (!parsed) {
      setStatusMessage(t('httpapi.curlInvalid'))
      return
    }
    setMethod(parsed.method)
    const { base, query } = splitUrlBaseAndQuery(parsed.url)
    setUrlBase(base)
    setParamRows(query ? parseQueryString(query) : [emptyKVRow()])
    const split = extractCookieRows(parsed.headers)
    setHeaderRows(split.headers)
    setCookieRows(split.cookies)
    setBody(parsed.body)
    setBodyMode(parsed.body ? detectBodyMode(parsed.body, kvRowsToHeaders(parsed.headers)) : 'none')
    const auth = extractBearerToken(parsed.headers)
    setAuthMode(auth.mode)
    setAuthToken(auth.token)
    setCurlOpen(false)
    markDirty()
    setStatusMessage(t('httpapi.curlImported'))
  }

  const selectItem = (item: HTTPSavedRequest) => {
    runWithDiscardCheck(() => {
      setActiveId(item.id)
      loadEditor(item)
      setResponse(null)
    })
  }

  useWorkbenchCommand(Capability.HttpApiOpen, (cmd) => {
    const requestId = payloadStr(cmd.payload, 'requestId')
    if (!requestId) return
    void (async () => {
      try {
        const list = await refreshList()
        const item = list.find((x) => x.id === requestId)
        if (!item) {
          setStatusMessage(`未找到请求 ${requestId}`)
          return
        }
        selectItem(item)
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    })()
  })

  /** createNew 新建接口并立即落库，左侧目录树即时显示（Apifox 式）。 */
  const createNew = (targetFolderId = '') => {
    runWithDiscardCheck(() => {
      void (async () => {
        try {
          const nextName = nextUntitledHttpName(items, t('httpapi.untitledRequest'))
          const saved = (await api.saveHTTPRequest(
            model.HTTPSavedRequestDO.createFrom({
              id: '',
              folderId: targetFolderId,
              name: nextName,
              method: 'GET',
              url: NEW_REQUEST_DEFAULT_URL,
              paramsJson: '[]',
              headersJson: '[]',
              cookiesJson: '[]',
              body: '',
              notes: '',
              sortOrder: nextHttpChildSortOrder(folders, items, targetFolderId),
              createdAt: 0,
              updatedAt: 0,
            }),
          )) as HTTPSavedRequest
          setActiveId(saved.id)
          loadEditor(saved)
          setResponse(null)
          dirtyRef.current = false
          clearHttpStash('__draft__')
          await refreshList()
          setStatusMessage(t('httpapi.requestCreated'))
        } catch (e) {
          setStatusMessage((e as Error).message)
        }
      })()
    })
  }

  /** onTreeDrop 拖拽后持久化目录树布局（移入/排序）。 */
  const onTreeDrop = useCallback(
    async (drag: HttpDragPayload, target: HttpDropTarget) => {
      try {
        const layout = await persistHttpTreeDrop(folders, items, drag, target)
        if (!layout) return
        if (drag.kind === 'api' && drag.id === activeId) {
          const pid = target.mode === 'into' ? target.parentId || '' : target.parentId || ''
          setFolderId(pid)
        }
        await refreshList()
        setStatusMessage(t('httpapi.treeLayoutSaved'))
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    },
    [folders, items, activeId, refreshList, setStatusMessage, t],
  )

  /** moveApiToFolder 将接口移入目录（folderId 为空为根目录）。 */
  const moveApiToFolder = useCallback(
    async (apiId: string, targetFolderId: string) => {
      await onTreeDrop({ kind: 'api', id: apiId }, { mode: 'into', parentId: targetFolderId || '' })
      const target = targetFolderId || ''
      setStatusMessage(target ? t('httpapi.movedToFolder') : t('httpapi.movedToRoot'))
    },
    [onTreeDrop, setStatusMessage, t],
  )

  const applyHistory = (h: HttpHistoryEntry) => {
    const apply = () => {
      const item = items.find((i) => i.url === h.url && i.method === h.method)
      if (item) {
        setActiveId(item.id)
        loadEditor(item)
        setResponse(null)
      } else {
        setActiveId('')
        setName(h.name)
        setMethod(h.method)
        const { base, query } = splitUrlBaseAndQuery(h.url)
        setUrlBase(base)
        setParamRows(parseQueryString(query))
        markDirty()
      }
      setHistoryOpen(false)
    }
    runWithDiscardCheck(apply)
  }

  const responseBodyDisplay =
    response && prettyResponse && !response.error ? prettyPrintBody(response.body) : response?.body

  const reqTabs: RequestTab[] = ['params', 'body', 'headers', 'cookies', 'auth']
  const resTabs: ResponseTab[] = ['body', 'cookie', 'header', 'actual']

  return (
    <div className="product-workbench httpapi-workbench apifox-theme">
      <div className="product-body">
        <HttpApiSidebar
          folders={folders}
          items={items}
          activeId={activeId}
          filter={filter}
          onFilter={setFilter}
          onSelectApi={selectItem}
          onCreateApi={createNew}
          onRefresh={refreshAll}
          onContextApi={(e, item) => {
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY, item })
          }}
          onAfterBatchDelete={(deletedApiIds) => {
            if (deletedApiIds.includes(activeId)) {
              setActiveId('')
              loadEditor(null)
              setResponse(null)
            }
          }}
          onTreeDrop={onTreeDrop}
        />

        <main className="app-main httpapi-workspace">
          <header className="httpapi-run-header">
            <div className="httpapi-run-title">
              <span className="httpapi-run-mode">{t('httpapi.runMode')}</span>
              <input
                className="httpapi-run-name"
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty() }}
                placeholder={t('httpapi.namePlaceholder')}
              />
            </div>
            <div className="httpapi-run-actions">
              <label className="httpapi-env-quick">
                <span className="httpapi-env-quick-label">{t('httpapi.activeEnv')}</span>
                <Select
                  className="wn-input wn-input-sm"
                  value={activeEnvId}
                  title={t('httpapi.envQuickHint')}
                  options={[
                    { value: '', label: t('httpapi.noEnv') },
                    ...envs.map((e) => ({ value: e.id, label: e.name })),
                  ]}
                  onChange={setActiveEnvId}
                />
              </label>
              <button
                type="button"
                className="httpapi-env-trigger"
                title={t('httpapi.envManageHint')}
                {...pressProps(() => setEnvModalOpen(true), { stop: true })}
              >
                {t('httpapi.envManage')}
              </button>
              <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" {...pressProps(() => setHistoryOpen((v) => !v))}>
                {t('httpapi.history')}
              </button>
              <button
                type="button"
                className="wn-btn wn-btn-xs wn-btn-ghost"
                {...pressProps(() => {
                  setCurlText('')
                  setCurlOpen(true)
                })}
              >
                {t('httpapi.importCurl')}
              </button>
              <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost" {...pressProps(exportCurl)}>
                {t('httpapi.exportCurl')}
              </button>
            </div>
          </header>

          <div className="httpapi-url-bar">
            <Select
              className={`httpapi-method httpapi-method-${method.toLowerCase()}`}
              value={method}
              options={METHODS.map((m) => ({ value: m, label: m }))}
              onChange={(v) => {
                setMethod(v)
                markDirty()
              }}
            />
            <input
              className="wn-input httpapi-url-input"
              value={urlBase}
              onChange={(e) => { setUrlBase(e.target.value); markDirty() }}
              placeholder={t('httpapi.urlPlaceholder')}
            />
            <button type="button" className="wn-btn wn-btn-sm httpapi-btn-stash" {...pressProps(stash)}>
              {t('httpapi.stash')}
            </button>
            <button type="button" className="wn-btn wn-btn-sm httpapi-btn-stash" {...pressProps(loadStashToEditor)}>
              {t('httpapi.loadStash')}
            </button>
            <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void save())}>
              {t('httpapi.save')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm httpapi-btn-send"
              disabled={sending}
              {...pressProps(() => void send(), { disabled: sending })}
            >
              <IconPlay size={14} /> {t('httpapi.send')}
            </button>
          </div>

          <div
            ref={hostRef}
            className="httpapi-split-host"
            style={{ gridTemplateRows: `${(1 - ratio) * 100}% 6px ${ratio * 100}%` }}
          >
            <section className="httpapi-req-pane">
              <nav className="httpapi-tabs apifox-tabs">
                {reqTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`httpapi-tab${reqTab === tab ? ' is-active' : ''}`}
                    {...pressProps(() => setReqTab(tab))}
                  >
                    {t(`httpapi.tab.${tab}`)}
                  </button>
                ))}
              </nav>
              <div className="httpapi-tab-panel">
                {reqTab === 'params' && (
                  <HttpKeyValueTable rows={paramRows} onChange={(rows) => { setParamRows(rows); markDirty() }} />
                )}
                {reqTab === 'body' && (
                  <div className="httpapi-body-pane">
                    <div className="httpapi-body-type-row">
                      <span className="httpapi-body-type-label">{t('httpapi.bodyType')}</span>
                      {(['none', 'form', 'json', 'xml', 'raw'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`httpapi-body-type-btn${bodyMode === mode ? ' is-active' : ''}`}
                          disabled={!methodAllowsBody(method) && mode !== 'none'}
                          {...pressProps(
                            () => {
                              setBodyMode(mode)
                              if (mode === 'json' && body.trim()) setBody(prettyPrintBody(body))
                              setHeaderRows(applyBodyModeHeaders(headerRows, mode))
                              markDirty()
                            },
                            { disabled: !methodAllowsBody(method) && mode !== 'none' },
                          )}
                        >
                          {t(`httpapi.bodyMode.${mode}`)}
                        </button>
                      ))}
                    </div>
                    {bodyMode === 'form' && methodAllowsBody(method) ? (
                      <HttpKeyValueTable rows={formRows} onChange={(rows) => { setFormRows(rows); markDirty() }} />
                    ) : bodyMode !== 'none' && methodAllowsBody(method) ? (
                      <textarea
                        className="wn-input httpapi-body-editor"
                        value={body}
                        onChange={(e) => { setBody(e.target.value); markDirty() }}
                        placeholder={t('httpapi.bodyPlaceholder')}
                        spellCheck={false}
                      />
                    ) : (
                      <p className="empty-hint">{t('httpapi.bodyDisabled')}</p>
                    )}
                  </div>
                )}
                {reqTab === 'headers' && (
                  <HttpKeyValueTable rows={headerRows} onChange={(rows) => { setHeaderRows(rows); markDirty() }} />
                )}
                {reqTab === 'cookies' && (
                  <HttpKeyValueTable rows={cookieRows} onChange={(rows) => { setCookieRows(rows); markDirty() }} />
                )}
                {reqTab === 'auth' && (
                  <div className="httpapi-auth-pane">
                    <label className="wn-label">{t('httpapi.authType')}</label>
                    <Select
                      value={authMode}
                      options={[
                        { value: 'none', label: t('httpapi.authNone') },
                        { value: 'bearer', label: t('httpapi.authBearer') },
                      ]}
                      onChange={(v) => {
                        setAuthMode(v as HttpAuthMode)
                        markDirty()
                      }}
                    />
                    {authMode === 'bearer' && (
                      <input
                        className="wn-input"
                        value={authToken}
                        onChange={(e) => { setAuthToken(e.target.value); markDirty() }}
                        placeholder={t('httpapi.bearerPlaceholder')}
                      />
                    )}
                  </div>
                )}
              </div>
            </section>

            <ResizeHandle axis="y" onMouseDown={onResizeStart} title={t('httpapi.resize')} className="httpapi-splitter" />

            <section className="httpapi-res-pane">
              <div className="httpapi-res-title-row">
                <span className="httpapi-res-title">{t('httpapi.responseTitle')}</span>
                {response && (
                  <div className="httpapi-res-meta">
                    {!response.error && (
                      <span className={`httpapi-status-pill tone-${statusTone(response.statusCode)}`}>
                        {response.statusCode} {response.status}
                      </span>
                    )}
                    <span>{t('httpapi.elapsed', { ms: response.elapsedMs })}</span>
                    {response.body && <span>{formatBodySize(response.body)}</span>}
                  </div>
                )}
              </div>
              <nav className="httpapi-tabs apifox-tabs">
                {resTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`httpapi-tab${resTab === tab ? ' is-active' : ''}`}
                    {...pressProps(() => setResTab(tab))}
                  >
                    {t(`httpapi.resTab.${tab}`)}
                  </button>
                ))}
              </nav>
              <div className="httpapi-res-panel">
                {!response ? (
                  <div className="httpapi-response-empty">{t('httpapi.noResponse')}</div>
                ) : resTab === 'header' ? (
                  <pre className="httpapi-pre">
                    {response.headers?.length
                      ? response.headers.map((h) => `${h.key}: ${h.value}`).join('\n')
                      : '—'}
                  </pre>
                ) : resTab === 'cookie' ? (
                  <pre className="httpapi-pre">
                    {response.headers
                      ?.filter((h) => h.key.toLowerCase() === 'set-cookie')
                      .map((h) => h.value)
                      .join('\n') || '—'}
                  </pre>
                ) : resTab === 'actual' ? (
                  <pre className="httpapi-pre">{lastSentCurl || '—'}</pre>
                ) : (
                  <pre className="httpapi-pre">{responseBodyDisplay || response.error}</pre>
                )}
              </div>
              {resTab === 'body' && response?.body && (
                <div className="httpapi-res-toolbar">
                  <button
                    type="button"
                    className="wn-btn wn-btn-xs wn-btn-ghost"
                    {...pressProps(() => setPrettyResponse((p) => !p))}
                  >
                    {prettyResponse ? t('httpapi.rawView') : t('httpapi.prettyView')}
                  </button>
                  <button
                    type="button"
                    className="wn-btn wn-btn-xs wn-btn-ghost"
                    {...pressProps(() =>
                      void navigator.clipboard.writeText(response.body).then(() => setStatusMessage(t('httpapi.copied'))),
                    )}
                  >
                    {t('httpapi.copyBody')}
                  </button>
                </div>
              )}
            </section>
          </div>

          {historyOpen && (
            <>
              <div
                className="httpapi-history-backdrop"
                {...pressProps(() => setHistoryOpen(false))}
              />
              <div className="httpapi-history-drawer" onPointerDown={(e) => e.stopPropagation()}>
                <div className="httpapi-history-drawer-head">
                  <span>{t('httpapi.recentHistory')}</span>
                  <button type="button" className="wn-modal-close-btn" {...pressProps(() => setHistoryOpen(false))}>
                    ×
                  </button>
                </div>
                <ul>
                  {history.length === 0 ? (
                    <li className="empty-hint">{t('httpapi.noHistory')}</li>
                  ) : (
                    history.map((h) => (
                      <li key={h.id} {...pressProps(() => applyHistory(h))}>
                        <span className={`httpapi-status-pill tone-${statusTone(h.statusCode)}`}>{h.statusCode || '—'}</span>
                        {h.method} {h.name || h.url}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </>
          )}
        </main>
      </div>

      <HttpEnvModal
        open={envModalOpen}
        activeEnvId={activeEnvId}
        onActiveEnvId={setActiveEnvId}
        onSaved={() => void refreshEnvs()}
        onClose={() => {
          setEnvModalOpen(false)
          void refreshEnvs()
        }}
      />

      {curlOpen && (
        <div className="wn-modal-backdrop" {...pressProps(() => setCurlOpen(false))}>
          <div className="wn-modal httpapi-curl-modal" onPointerDown={(e) => e.stopPropagation()} role="dialog">
            <header className="wn-modal-header wn-modal-header-bar">
              <h3 className="wn-modal-title">{t('httpapi.importCurl')}</h3>
              <button
                type="button"
                className="wn-modal-close-btn"
                aria-label={t('common.cancel')}
                {...pressProps(() => setCurlOpen(false))}
              >
                ×
              </button>
            </header>
            <div className="wn-modal-body">
              <textarea
                className="wn-input httpapi-curl-input"
                value={curlText}
                onChange={(e) => setCurlText(e.target.value)}
                placeholder={t('httpapi.curlPlaceholder')}
                spellCheck={false}
              />
            </div>
            <footer className="wn-modal-footer">
              <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" {...pressProps(() => setCurlOpen(false))}>
                {t('common.cancel')}
              </button>
              <button type="button" className="wn-btn wn-btn-sm httpapi-btn-send" {...pressProps(importCurl)}>
                {t('httpapi.curlApply')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {ctxMenu && (
        <HttpApiContextMenu
          menu={ctxMenu}
          folders={folders}
          onClose={() => setCtxMenu(null)}
          onMoveToFolder={(apiId, folderId) => void moveApiToFolder(apiId, folderId)}
          onSendToAgent={(item) =>
            openAgentDraft({ mentions: [mentionHttpRequest(item)], message: t('agent.draftHttp') })
          }
          onDuplicate={(item) => {
            runWithDiscardCheck(() => {
              loadEditor(item)
              setActiveId('')
              setName(`${item.name} (${t('httpapi.copySuffix')})`)
              markDirty()
              setStatusMessage(t('httpapi.duplicatedDraft'))
            })
          }}
          onDelete={(item) => setDeleteTarget(item)}
        />
      )}

      <ConfirmDialog
        open={discardOpen}
        title={t('httpapi.discardTitle')}
        message={t('httpapi.discardDirty')}
        confirmLabel={t('httpapi.discardConfirm')}
        danger
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />

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
    </div>
  )
}

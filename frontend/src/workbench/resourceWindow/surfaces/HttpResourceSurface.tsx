import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { HTTPResponse, HTTPSavedRequest } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { useI18n } from '../../../i18n'
import { model } from '../../../../wailsjs/go/models'
import {
  buildUrlWithParams,
  kvRowsToHeaders,
  parseKVJson,
} from '../../../products/httpapi/httpUtils'
import { openAsProduct } from '../openResource'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** HttpResourceSurface 嵌入式 HTTP：加载已存请求，可改 URL/Body 并发送。 */
export function HttpResourceSurface({ window: win }: Props) {
  const { t } = useI18n()
  const [req, setReq] = useState<HTTPSavedRequest | null>(null)
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [response, setResponse] = useState<HTTPResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const list = await api.listHTTPRequests()
      const hit = list.find((r) => r.id === win.resourceId)
      if (!hit) throw new Error(t('resourceWindow.httpMissing'))
      setReq(hit)
      setMethod((hit.method || 'GET').toUpperCase())
      const params = parseKVJson(hit.paramsJson || '[]')
      setUrl(buildUrlWithParams(hit.url || '', params))
      setBody(hit.body || '')
      setResponse(null)
    } catch (e) {
      setError((e as Error).message)
      setReq(null)
    } finally {
      setBusy(false)
    }
  }, [t, win.resourceId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    if (!url.trim()) {
      setError(t('httpapi.errUrl'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const headers = req ? kvRowsToHeaders(parseKVJson(req.headersJson || '[]')) : []
      const exec = model.HTTPExecuteRequestDO.createFrom({
        method: method || 'GET',
        url: url.trim(),
        headers,
        body,
        timeoutMs: 30000,
        envId: '',
      })
      const res = (await api.executeHTTPRequest(exec)) as HTTPResponse
      setResponse(res)
      if (res.error) setError(res.error)
    } catch (e) {
      setError((e as Error).message)
      setResponse(null)
    } finally {
      setBusy(false)
    }
  }

  if (error && !req) {
    return (
      <div className="rw-surface rw-surface-http">
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[
            { label: t('common.retry'), onPress: () => void load(), primary: true },
            {
              label: t('resourceWindow.openInProduct'),
              onPress: () => openAsProduct({ kind: 'http', resourceId: win.resourceId, title: win.title }),
            },
          ]}
        />
      </div>
    )
  }

  if (!req && busy) {
    return (
      <div className="rw-surface rw-surface-http rw-surface-loading">
        <span>{t('shell.loadingProduct')}</span>
      </div>
    )
  }

  return (
    <div className="rw-surface rw-surface-http">
      <div className="rw-surface-toolbar">
        <span className="rw-surface-meta" title={req?.name || win.title}>
          {req?.name || win.title}
        </span>
        <button
          type="button"
          className="wn-btn wn-btn-sm wn-btn-tool"
          {...pressProps(() =>
            openAsProduct({ kind: 'http', resourceId: win.resourceId, title: win.title }),
          )}
        >
          {t('resourceWindow.openInProduct')}
        </button>
      </div>
      <div className="rw-http-line">
        <select
          className="rw-http-method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          aria-label="method"
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="rw-http-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          aria-label="url"
        />
        <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={busy} {...pressProps(() => void send())}>
          {busy ? t('httpapi.sending') : t('resourceWindow.httpSend')}
        </button>
      </div>
      <textarea
        className="rw-http-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck={false}
        placeholder={t('resourceWindow.httpBodyPlaceholder')}
        rows={3}
      />
      {error ? <p className="rw-surface-error">{error}</p> : null}
      <pre className="rw-http-result">
        {response
          ? `${response.statusCode} ${response.status} · ${response.elapsedMs}ms${
              response.truncated ? ' · truncated' : ''
            }\n\n${response.body || ''}`
          : t('resourceWindow.httpResultEmpty')}
      </pre>
    </div>
  )
}

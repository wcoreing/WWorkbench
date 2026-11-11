import { fail, ok, type CmdResult } from '../shared/types'

type NetEntry = {
  requestId: string
  url: string
  method: string
  status?: number
  mimeType?: string
  completed: boolean
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  body?: string
  bodyError?: string
}

type TabNet = {
  attachedHere: boolean
  entries: Map<string, NetEntry>
  order: string[]
}

const byTab = new Map<number, TabNet>()
let listenerBound = false

function ensureListener() {
  if (listenerBound) return
  listenerBound = true
  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId
    if (tabId == null) return
    const state = byTab.get(tabId)
    if (!state) return
    if (method === 'Network.requestWillBeSent') {
      const id = String(params.requestId)
      const req = params.request || {}
      const entry: NetEntry = {
        requestId: id,
        url: String(req.url || ''),
        method: String(req.method || 'GET'),
        completed: false,
        requestHeaders: req.headers || undefined,
        requestBody: typeof req.postData === 'string' ? req.postData.slice(0, 8000) : undefined,
      }
      state.entries.set(id, entry)
      state.order.push(id)
      if (state.order.length > 400) {
        const drop = state.order.shift()
        if (drop) state.entries.delete(drop)
      }
    } else if (method === 'Network.responseReceived') {
      const id = String(params.requestId)
      const entry = state.entries.get(id)
      if (!entry) return
      const res = params.response || {}
      entry.status = Number(res.status) || undefined
      entry.mimeType = res.mimeType || undefined
      entry.responseHeaders = res.headers || undefined
    } else if (method === 'Network.loadingFinished') {
      const id = String(params.requestId)
      const entry = state.entries.get(id)
      if (entry) entry.completed = true
    }
  })
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null) byTab.delete(source.tabId)
  })
}

async function attachNet(tabId: number) {
  ensureListener()
  let state = byTab.get(tabId)
  if (state) return state
  const target = { tabId }
  let attachedHere = false
  try {
    await chrome.debugger.attach(target, '1.3')
    attachedHere = true
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!/Already attached/i.test(msg)) throw e
  }
  await chrome.debugger.sendCommand(target, 'Network.enable', {
    maxResourceBufferSize: 5 * 1024 * 1024,
    maxTotalBufferSize: 10 * 1024 * 1024,
  })
  state = { attachedHere, entries: new Map(), order: [] }
  byTab.set(tabId, state)
  return state
}

async function detachNet(tabId: number) {
  const state = byTab.get(tabId)
  byTab.delete(tabId)
  if (!state) return { stopped: true, detached: false }
  if (state.attachedHere) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Network.disable', {})
    } catch {
      /* ignore */
    }
    try {
      await chrome.debugger.detach({ tabId })
    } catch {
      /* ignore */
    }
  }
  return { stopped: true, detached: state.attachedHere }
}

export async function handleNetwork(tabId: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const cmd = String(args?.cmd || args?.action || 'list').toLowerCase()
  try {
    if (cmd === 'start') {
      await attachNet(tabId)
      return ok({ capturing: true, tabId, note: '开始捕获本标签网络；list 查看，detail 取 body，stop 结束' })
    }
    if (cmd === 'stop') {
      const r = await detachNet(tabId)
      return ok(r)
    }
    if (cmd === 'list') {
      const state = byTab.get(tabId)
      if (!state) return fail('尚未 network start', 'not_started')
      const filter = String(args?.filter || '').toLowerCase()
      const list = state.order
        .map((id) => state.entries.get(id)!)
        .filter(Boolean)
        .filter((e) => !filter || e.url.toLowerCase().includes(filter))
        .slice(-(Number(args?.limit) || 80))
        .map((e) => ({
          requestId: e.requestId,
          url: e.url.slice(0, 300),
          method: e.method,
          status: e.status,
          mimeType: e.mimeType,
          completed: e.completed,
        }))
      return ok({ count: list.length, capturing: true, requests: list })
    }
    if (cmd === 'detail') {
      const state = byTab.get(tabId)
      if (!state) return fail('尚未 network start', 'not_started')
      const requestId = String(args?.requestId || '').trim()
      if (!requestId) return fail('请提供 requestId', 'invalid_arg')
      const entry = state.entries.get(requestId)
      if (!entry) return fail('未知 requestId', 'not_found')
      const out: NetEntry = { ...entry }
      if (entry.completed) {
        try {
          const bodyRes = (await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
            requestId,
          })) as { body?: string; base64Encoded?: boolean }
          let body = bodyRes?.body || ''
          if (bodyRes?.base64Encoded) {
            out.bodyError = 'body 为 base64（二进制），已省略'
          } else {
            if (body.length > 100000) body = body.slice(0, 100000) + '\n…[truncated]'
            out.body = body
          }
        } catch (e) {
          out.bodyError = String((e as Error)?.message || e)
        }
      } else {
        out.bodyError = '请求未完成，稍后 detail'
      }
      return ok(out)
    }
    return fail('未知 network cmd: ' + cmd + '（start|stop|list|detail）', 'invalid_arg')
  } catch (e) {
    return fail('network 失败: ' + String((e as Error)?.message || e), 'network_failed')
  }
}

import { EXT_VERSION } from '../shared/version'

// 常驻页面持有 WebSocket，避免 MV3 service worker 休眠后断线
const BRIDGE_URL = 'ws://127.0.0.1:18765/ext'
const RECONNECT_MS = 1500

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    ws = new WebSocket(BRIDGE_URL)
  } catch {
    scheduleReconnect()
    return
  }
  ws.addEventListener('open', () => {
    ws!.send(JSON.stringify({ type: 'hello', version: EXT_VERSION, role: 'extension-offscreen' }))
    chrome.runtime.sendMessage({ channel: 'ww-bridge', kind: 'connected' }).catch(() => {})
  })
  ws.addEventListener('message', (ev) => {
    let msg: any
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (msg?.type === 'ping') {
      ws?.send(JSON.stringify({ type: 'pong' }))
      return
    }
    if (msg?.id && msg?.action) {
      chrome.runtime.sendMessage({ channel: 'ww-bridge', kind: 'command', msg }, (res) => {
        const err = chrome.runtime.lastError
        if (err) {
          reply(msg.id, { ok: false, error: err.message })
          return
        }
        reply(msg.id, res || { ok: false, error: 'background 无响应' })
      })
    }
  })
  ws.addEventListener('close', () => {
    ws = null
    chrome.runtime.sendMessage({ channel: 'ww-bridge', kind: 'disconnected' }).catch(() => {})
    scheduleReconnect()
  })
  ws.addEventListener('error', () => {
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
  })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_MS)
}

function reply(id: string, payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ id, ...payload }))
}

function pushEvent(action: string, data: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connect()
    return
  }
  ws.send(JSON.stringify({ type: 'event', action, data: data || {} }))
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.channel !== 'ww-bridge') return false
  if (msg.kind === 'ping-sw') {
    sendResponse({ ok: true, ws: ws?.readyState === WebSocket.OPEN })
    return true
  }
  if (msg.kind === 'push-event') {
    pushEvent(String(msg.action || ''), (msg.data as Record<string, unknown>) || {})
    sendResponse({ ok: true })
    return true
  }
  return false
})

connect()
setInterval(() => {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) connect()
}, 5000)

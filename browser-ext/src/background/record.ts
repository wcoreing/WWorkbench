/** 用户操作录制：状态、推事件、启停 content 监听。 */
import { getAttachedTabId, loadAttached, saveAttached } from './state'
import { ensureContent, ensureOffscreen, resolveTabId, sendToTab } from './tabs'

export type RecordState = {
  recording: boolean
  session: string
  tabId: number | null
  title: string
  url: string
  startedAt: number
}

let state: RecordState = {
  recording: false,
  session: '',
  tabId: null,
  title: '',
  url: '',
  startedAt: 0,
}

let navListenerInstalled = false
let lastNavURL = ''

export function getRecordState(): RecordState {
  return { ...state }
}

function pushEvent(action: string, data: Record<string, unknown>) {
  chrome.runtime
    .sendMessage({ channel: 'ww-bridge', kind: 'push-event', action, data })
    .catch(() => {})
}

export function pushRecordStep(step: {
  action: string
  summary?: string
  locator?: Record<string, unknown>
  args?: Record<string, unknown>
  url?: string
  ok?: boolean
  error?: string
}) {
  if (!state.recording || !state.session) return
  pushEvent('record_step', {
    session: state.session,
    action: step.action,
    summary: step.summary || step.action,
    locator: step.locator || {},
    args: step.args || {},
    url: step.url || state.url || '',
    ok: step.ok !== false,
    error: step.error || '',
  })
}

async function enableOnTab(tabId: number) {
  await ensureContent(tabId, true)
  const res = await sendToTab(tabId, 'record_enable', { session: state.session })
  if (!res?.ok) {
    await ensureContent(tabId, true)
    await sendToTab(tabId, 'record_enable', { session: state.session })
  }
}

async function disableOnTab(tabId: number | null) {
  if (!tabId) return
  try {
    await sendToTab(tabId, 'record_disable', {})
  } catch {
    /* ignore */
  }
}

function installNavListener() {
  if (navListenerInstalled) return
  navListenerInstalled = true
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!state.recording || state.tabId !== tabId) return
    if (info.status === 'complete' && tab.url) {
      const url = tab.url
      if (url && url !== lastNavURL && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) {
        lastNavURL = url
        state.url = url
        if (tab.title) state.title = tab.title
        pushRecordStep({
          action: 'navigate',
          summary: `导航 ${url}`,
          locator: { url },
          args: { url },
          url,
        })
        void enableOnTab(tabId)
      }
    }
  })
}

/** 开始录制当前/附着标签上的用户操作。 */
export async function startRecording(opts?: { title?: string; tabId?: number }) {
  await ensureOffscreen()
  await loadAttached()
  let tabId = opts?.tabId || (await resolveTabId())
  if (!tabId) {
    const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    tabId = active?.id || null
  }
  if (!tabId) {
    return { ok: false as const, error: '没有可录制的标签，请先打开普通网页', code: 'no_tab' }
  }
  try {
    await chrome.tabs.get(tabId)
  } catch {
    return { ok: false as const, error: '标签已关闭', code: 'no_tab' }
  }

  if (state.recording) {
    await stopRecording()
  }

  const tab = await chrome.tabs.get(tabId)
  const url = tab.url || ''
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
    return { ok: false as const, error: '系统页无法录制，请改开普通 https 网页', code: 'invalid_url' }
  }

  await saveAttached(tabId)
  const session = `rec-${Date.now().toString(36)}-${tabId}`
  const title = (opts?.title || tab.title || '网页录制').trim() || '网页录制'
  state = {
    recording: true,
    session,
    tabId,
    title,
    url,
    startedAt: Date.now(),
  }
  lastNavURL = url
  installNavListener()
  await enableOnTab(tabId)

  pushEvent('record_start', {
    session,
    tabId,
    url,
    title,
  })

  return {
    ok: true as const,
    data: {
      recording: true,
      session,
      tabId,
      url,
      title,
    },
  }
}

/** 停止录制。 */
export async function stopRecording() {
  const prev = { ...state }
  await disableOnTab(state.tabId)
  state = {
    recording: false,
    session: '',
    tabId: null,
    title: '',
    url: '',
    startedAt: 0,
  }
  if (prev.session) {
    pushEvent('record_stop', { session: prev.session })
  }
  return {
    ok: true as const,
    data: {
      recording: false,
      session: prev.session || '',
      tabId: prev.tabId,
    },
  }
}

/** content → background：用户操作一步。 */
export function handleContentRecordStep(step: Record<string, unknown>, senderTabId?: number) {
  if (!state.recording) return
  if (state.tabId && senderTabId && senderTabId !== state.tabId) return
  pushRecordStep({
    action: String(step.action || ''),
    summary: typeof step.summary === 'string' ? step.summary : undefined,
    locator: (step.locator as Record<string, unknown>) || {},
    args: (step.args as Record<string, unknown>) || {},
    url: typeof step.url === 'string' ? step.url : undefined,
    ok: step.ok !== false,
    error: typeof step.error === 'string' ? step.error : undefined,
  })
}

export function recordStatusExtra() {
  return {
    recording: state.recording,
    recordingSession: state.session || undefined,
    attachedTabId: state.tabId ?? getAttachedTabId(),
  }
}

import { getAttachedTabId, loadAttached, saveAttached, sleep } from './state'

export async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  })
  if (contexts && contexts.length > 0) return
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Maintain WebSocket to WWorkbench local browser bridge',
    })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!/Already exists|Only a single/i.test(msg)) {
      console.warn('offscreen create', e)
    }
  }
}

/** 与 content/version.ts CONTENT_VER 同步；ping.ver 落后则强制重注。 */
const EXPECT_CONTENT_VER = 20

/** 先 ping content；不通或版本落后再注入。避免旧 fill 脚本残留。 */
export async function ensureContent(tabId: number, force = false) {
  if (!force) {
    const ping = await sendToTab(tabId, 'ping', {})
    const ver = Number(ping?.data?.ver || 0)
    if (ping?.ok && ver >= EXPECT_CONTENT_VER) return
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
    await sleep(30)
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (/chrome:\/\/|edge:\/\/|about:|chrome-extension:\/\/|Cannot access contents|Cannot access a chrome/i.test(msg)) {
      throw new Error('此页无法注入脚本（系统页/扩展页），请改开普通 https 网页后再附着')
    }
  }
}

/** 是否把 Chrome 窗口抢到前台。默认 false，保持 WWorkbench 焦点；仅 args.activate === true 时抢焦。 */
export function wantActivateWindow(args?: Record<string, unknown>) {
  return args?.activate === true
}

/**
 * 确保目标标签在其窗口内为当前页（截图/指针需要），默认不聚焦 Chrome 窗口。
 * activateWindow=true 才会 windows.update({ focused: true })。
 */
export async function focusTab(tabId: number, activateWindow = false) {
  try {
    const tab = await chrome.tabs.get(tabId)
    await chrome.tabs.update(tabId, { active: true })
    if (activateWindow && tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
  } catch {
    /* ignore */
  }
}

export function sendToTab(tabId: number, action: string, args?: Record<string, unknown>) {
  return new Promise<{ ok: boolean; data?: any; error?: string; code?: string }>((resolve) => {
    chrome.tabs.sendMessage(tabId, { channel: 'ww-browser', action, args }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message, code: 'no_receiver' })
        return
      }
      resolve(res || { ok: false, error: '无响应', code: 'empty' })
    })
  })
}

export async function resolveTabId() {
  await loadAttached()
  let tid = getAttachedTabId()
  if (tid) {
    try {
      await chrome.tabs.get(tid)
      return tid
    } catch {
      await saveAttached(null)
      tid = null
    }
  }
  const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (active?.id) {
    await saveAttached(active.id)
    return active.id
  }
  return null
}

export async function waitTabComplete(tabId: number, timeoutMs: number) {
  const deadline = Date.now() + (timeoutMs || 15000)
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab.status === 'complete') return
    } catch {
      return
    }
    await sleep(120)
  }
}

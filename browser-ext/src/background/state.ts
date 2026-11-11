let attachedTabId: number | null = null

export function getAttachedTabId() {
  return attachedTabId
}

export async function loadAttached() {
  try {
    const got = await chrome.storage.session.get(['attachedTabId'])
    if (got?.attachedTabId) attachedTabId = Number(got.attachedTabId) || null
  } catch {
    /* ignore */
  }
}

export async function saveAttached(tabId: number | null) {
  attachedTabId = tabId || null
  try {
    if (attachedTabId) await chrome.storage.session.set({ attachedTabId })
    else await chrome.storage.session.remove('attachedTabId')
  } catch {
    /* ignore */
  }
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * 任务会话 ↔ Chrome 标签组（对齐 Kimi：one task = one session = one tab group）。
 */
export type SessionLedger = {
  name: string
  groupId: number | null
  groupTitle: string
  windowId: number | null
  ownedTabIds: number[]
  borrowedTabIds: number[]
}

const COLOR_CYCLE: chrome.tabGroups.ColorEnum[] = [
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
]

const STORE_KEY = 'wwSessions'
let ledgers: Record<string, SessionLedger> = {}
let colorIdx = 0

export async function loadSessions() {
  try {
    const got = await chrome.storage.session.get([STORE_KEY, 'wwSessionColorIdx'])
    ledgers = (got?.[STORE_KEY] as Record<string, SessionLedger>) || {}
    colorIdx = Number(got?.wwSessionColorIdx) || 0
  } catch {
    ledgers = {}
  }
}

async function persist() {
  try {
    await chrome.storage.session.set({ [STORE_KEY]: ledgers, wwSessionColorIdx: colorIdx })
  } catch {
    /* ignore */
  }
}

function ensureLedger(session: string, groupTitle?: string): SessionLedger {
  const name = session.trim()
  if (!ledgers[name]) {
    ledgers[name] = {
      name,
      groupId: null,
      groupTitle: (groupTitle || name).trim() || name,
      windowId: null,
      ownedTabIds: [],
      borrowedTabIds: [],
    }
  } else if (groupTitle && groupTitle.trim()) {
    ledgers[name].groupTitle = groupTitle.trim()
  }
  return ledgers[name]
}

export function getLedger(session: string | undefined | null): SessionLedger | null {
  if (!session?.trim()) return null
  return ledgers[session.trim()] || null
}

function uniqPush(arr: number[], id: number) {
  if (!arr.includes(id)) arr.push(id)
}

function stripId(arr: number[], id: number) {
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
}

/** 无 session 时用 group_title 生成稳定任务名，避免「有标题却不建组」。 */
export function resolveSessionName(session?: string | null, groupTitle?: string | null): string {
  const s = (session || '').trim()
  if (s) return s
  const t = (groupTitle || '').trim()
  if (!t) return ''
  return (
    'g-' +
    t
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff-]+/g, '')
      .slice(0, 32)
  )
}

/** 把标签归入 session 对应的标签组；borrowed 的标签 close_session 时不关。 */
export async function bindTabToSession(
  session: string | undefined | null,
  tabId: number,
  opts?: { borrowed?: boolean; groupTitle?: string; createGroup?: boolean },
): Promise<{ groupId: number | null; groupTitle: string; borrowed: boolean; session: string } | null> {
  const sessionName = resolveSessionName(session, opts?.groupTitle)
  if (!sessionName || !tabId) return null
  if (typeof chrome.tabGroups === 'undefined' || !chrome.tabs.group) {
    console.warn('tabGroups API unavailable — reload extension with tabGroups permission')
    return null
  }
  await loadSessions()
  const ledger = ensureLedger(sessionName, opts?.groupTitle || sessionName)
  const borrowed = !!opts?.borrowed
  if (borrowed) {
    uniqPush(ledger.borrowedTabIds, tabId)
    stripId(ledger.ownedTabIds, tabId)
  } else {
    uniqPush(ledger.ownedTabIds, tabId)
    stripId(ledger.borrowedTabIds, tabId)
  }

  // 仅当明确 createGroup===false 时不入组；默认入组，标签栏才看得到彩色标题
  if (opts?.createGroup === false) {
    await persist()
    return { groupId: ledger.groupId, groupTitle: ledger.groupTitle, borrowed, session: sessionName }
  }

  try {
    const tab = await chrome.tabs.get(tabId)
    ledger.windowId = tab.windowId ?? ledger.windowId

    let groupId = ledger.groupId
    if (groupId != null) {
      try {
        const g = await chrome.tabGroups.get(groupId)
        // 组若在别的窗口，重建
        if (g.windowId !== tab.windowId) {
          groupId = null
          ledger.groupId = null
        }
      } catch {
        groupId = null
        ledger.groupId = null
      }
    }

    if (groupId == null) {
      groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } })
      ledger.groupId = groupId
      const color = COLOR_CYCLE[colorIdx % COLOR_CYCLE.length]
      colorIdx += 1
      await chrome.tabGroups.update(groupId, {
        title: ledger.groupTitle.slice(0, 50),
        color,
        collapsed: false,
      })
    } else {
      await chrome.tabs.group({ tabIds: [tabId], groupId })
      await chrome.tabGroups.update(groupId, {
        title: ledger.groupTitle.slice(0, 50),
        collapsed: false,
      })
    }
    await persist()
    return { groupId: ledger.groupId, groupTitle: ledger.groupTitle, borrowed, session: sessionName }
  } catch (e) {
    console.warn('tab group bind failed', e)
    await persist()
    return { groupId: ledger.groupId, groupTitle: ledger.groupTitle, borrowed, session: sessionName }
  }
}

/** 按 url 子串把已打开标签收进同一任务组（补救：先前未带 session 打开的页）。 */
export async function groupMatchingTabs(
  session: string,
  groupTitle: string,
  urlIncludes: string,
  opts?: { borrowed?: boolean },
): Promise<{ session: string; groupId: number | null; groupTitle: string; tabIds: number[] }> {
  const sessionName = resolveSessionName(session, groupTitle) || 'task'
  const needle = (urlIncludes || '').toLowerCase()
  const tabs = await chrome.tabs.query({})
  const matched = tabs.filter(
    (t) =>
      t.id != null &&
      t.url &&
      !t.url.startsWith('chrome://') &&
      (!needle || t.url.toLowerCase().includes(needle)),
  )
  const tabIds: number[] = []
  let groupId: number | null = null
  let title = groupTitle || sessionName
  for (const t of matched) {
    const g = await bindTabToSession(sessionName, t.id!, {
      borrowed: opts?.borrowed !== false,
      groupTitle: title,
      createGroup: true,
    })
    if (g) {
      groupId = g.groupId
      title = g.groupTitle
      tabIds.push(t.id!)
    }
  }
  return { session: sessionName, groupId, groupTitle: title, tabIds }
}

export async function closeSession(session: string): Promise<{ closed: number; kept: number[]; groupTitle: string }> {
  await loadSessions()
  const name = session.trim()
  const ledger = ledgers[name]
  if (!ledger) return { closed: 0, kept: [], groupTitle: name }

  const borrowed = new Set(ledger.borrowedTabIds)
  let closed = 0
  for (const id of [...ledger.ownedTabIds]) {
    if (borrowed.has(id)) continue
    try {
      await chrome.tabs.remove(id)
      closed += 1
    } catch {
      /* already gone */
    }
  }
  const kept = [...ledger.borrowedTabIds]
  delete ledgers[name]
  await persist()
  return { closed, kept, groupTitle: ledger.groupTitle }
}

export async function listSessionSummary() {
  await loadSessions()
  return Object.values(ledgers).map((l) => ({
    session: l.name,
    groupId: l.groupId,
    groupTitle: l.groupTitle,
    owned: l.ownedTabIds.length,
    borrowed: l.borrowedTabIds.length,
  }))
}

export async function groupMetaForTab(tabId: number): Promise<{ groupId?: number; groupTitle?: string; session?: string }> {
  await loadSessions()
  for (const l of Object.values(ledgers)) {
    if (l.ownedTabIds.includes(tabId) || l.borrowedTabIds.includes(tabId)) {
      return { groupId: l.groupId || undefined, groupTitle: l.groupTitle, session: l.name }
    }
  }
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.groupId != null && tab.groupId >= 0) {
      const g = await chrome.tabGroups.get(tab.groupId)
      return { groupId: g.id, groupTitle: g.title || undefined }
    }
  } catch {
    /* ignore */
  }
  return {}
}

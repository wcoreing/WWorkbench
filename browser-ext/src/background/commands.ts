import { CAPABILITIES, EXT_VERSION } from '../shared/version'
import type { BridgeCommand, CmdResult } from '../shared/types'
import { fail, ok } from '../shared/types'
import { handleClick, handleDrag, handleWait } from './click'
import { sendWithRefRetry } from './retry'
import { finishSingleFill, tryHandleFillFields } from './fill_batch'
import { handleSelectOption } from './select'
import {
  bindTabToSession,
  closeSession,
  getLedger,
  groupMatchingTabs,
  groupMetaForTab,
  listSessionSummary,
  loadSessions,
  resolveSessionName,
} from './sessions'
import { getAttachedTabId, loadAttached, saveAttached, sleep } from './state'
import {
  ensureContent,
  focusTab,
  resolveTabId,
  sendToTab,
  waitTabComplete,
  wantActivateWindow,
} from './tabs'
import { handleNetwork } from './network'
import { handleUpload } from './upload'
import { getRecordState, recordStatusExtra, startRecording, stopRecording } from './record'
import { handleAxFind, handleAxSnapshot, maybeAttachSnapshot } from './ax_snapshot'
import { extractWaitFor, probeUntil } from './wait_for'

const READ_ACTIONS = new Set([
  'snapshot',
  'find',
  'probe',
  'frames',
  'viewport',
  'evaluate',
  'ping',
  'read_page',
])

const PAGE_ACTIONS = new Set([
  'snapshot',
  'fill',
  'find',
  'probe',
  'keys',
  'send_keys',
  'frames',
  'viewport',
  'evaluate',
  'read_page',
])

const RETRY_ACTIONS = new Set(['fill', 'keys', 'click', 'resolve_box'])

/** 归一化 Kimi 风格别名。 */
function normalizeAction(action: string, args: Record<string, unknown>) {
  let a = action
  const nextArgs = { ...args }
  if (a === 'send_keys') a = 'keys'
  if (a === 'mouse_click') {
    a = 'click'
    if (!nextArgs.mode) nextArgs.mode = 'pointer'
  }
  return { action: a, args: nextArgs }
}

async function withPage(
  action: string,
  args: Record<string, unknown>,
  opts?: { focus?: boolean },
): Promise<CmdResult> {
  const tid = await resolveTabId()
  if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
  if (opts?.focus) await focusTab(tid, wantActivateWindow(args))
  const act = action === 'send_keys' ? 'keys' : action
  await ensureContent(tid)
  const res =
    RETRY_ACTIONS.has(act) || act === 'fill' || act === 'keys'
      ? await sendWithRefRetry(tid, act, args)
      : await sendToTab(tid, act, args)
  if (!res?.ok && /Receiving end|Could not establish|no_receiver/i.test(res?.error || '')) {
    await ensureContent(tid, true)
    await sleep(40)
    const again = RETRY_ACTIONS.has(act) || act === 'fill' || act === 'keys'
      ? await sendWithRefRetry(tid, act, args)
      : await sendToTab(tid, act, args)
    return again?.ok ? ok(again.data) : fail(again?.error || '失败', again?.code || 'page_error')
  }
  return res?.ok ? ok(res.data) : fail(res?.error || '失败', res?.code || 'page_error')
}

async function handleFindTab(args: Record<string, unknown>, session?: string): Promise<CmdResult> {
  await loadAttached()
  const tabs = await chrome.tabs.query({})
  const usable = tabs.filter(
    (t) =>
      t.id != null &&
      t.url &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('chrome-extension://') &&
      !t.url.startsWith('edge://') &&
      !t.url.startsWith('about:'),
  )
  const finish = async (tab: chrome.tabs.Tab) => {
    await saveAttached(tab.id!)
    await ensureContent(tab.id!)
    const groupTitle = String(args?.group_title || args?.groupTitle || '')
    const sessionName = resolveSessionName(session, groupTitle)
    // 有 session/标题则入组（标签栏可见）；仍标记 borrowed，close_session 不关
    const g = await bindTabToSession(sessionName, tab.id!, {
      borrowed: true,
      createGroup: args?.joinGroup === false ? false : !!sessionName,
      groupTitle: groupTitle || undefined,
    })
    return ok({
      tabId: tab.id,
      url: tab.url,
      title: tab.title || '',
      borrowed: true,
      attached: true,
      session: g?.session || sessionName || undefined,
      groupId: g?.groupId ?? undefined,
      groupTitle: g?.groupTitle,
    })
  }
  if (args?.active) {
    const active = usable.find((t) => t.active) || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!active?.id || !usable.some((t) => t.id === active.id)) {
      return fail('当前没有可附着的活动标签', 'no_active_tab')
    }
    return finish(active)
  }
  const query = String(args?.url || args?.query || '').trim().toLowerCase()
  if (!query) return fail('请提供 url/query，或 active:true', 'invalid_arg')
  const hit = usable.find((t) => {
    const u = (t.url || '').toLowerCase()
    const title = (t.title || '').toLowerCase()
    try {
      const host = new URL(t.url || '').host.toLowerCase()
      return u.includes(query) || host.includes(query) || title.includes(query)
    } catch {
      return u.includes(query) || title.includes(query)
    }
  })
  if (!hit?.id) return fail('未找到匹配标签: ' + query, 'tab_not_found')
  return finish(hit)
}

/** 有界可写宏（allowWrite）：软写一次往返；不含 upload/drag/close_session。 */
const RUN_WRITE_ACTIONS = new Set([
  'fill',
  'click',
  'keys',
  'navigate',
  'select_option',
  'select',
  'network',
])

const RUN_ALWAYS_ACTIONS = new Set([
  ...READ_ACTIONS,
  'wait',
  'list_tabs',
  'status',
  'find_tab',
  'read_page',
])

function runAllowWrite(args: Record<string, unknown>): boolean {
  if (args.allowWrite === true || args.allow_write === true) return true
  const mode = String(args.mode || '')
    .trim()
    .toLowerCase()
  return mode === 'write' || mode === 'macro'
}

async function handleRun(args: Record<string, unknown>, session?: string): Promise<CmdResult> {
  const steps = Array.isArray(args?.steps) ? (args.steps as Array<{ action?: string; args?: Record<string, unknown> }>) : []
  if (!steps.length) return fail('run 需要 steps[]', 'invalid_arg')
  const allowWrite = runAllowWrite(args)
  const maxSteps = allowWrite ? 16 : 12
  if (steps.length > maxSteps) return fail(`run 最多 ${maxSteps} 步`, 'too_many_steps')
  const results: unknown[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] || {}
    const action = String(step.action || '').trim()
    if (!action) return fail(`steps[${i}] 缺 action`, 'invalid_arg')
    const norm = normalizeAction(action, step.args || {})
    const allowed =
      RUN_ALWAYS_ACTIONS.has(norm.action) || (allowWrite && RUN_WRITE_ACTIONS.has(norm.action))
    if (!allowed) {
      if (!allowWrite && RUN_WRITE_ACTIONS.has(norm.action)) {
        return fail(`run 默认可读；写步骤请传 allowWrite=true（或 mode=macro）：${norm.action}`, 'write_in_run')
      }
      return fail(`run 不允许：${norm.action}`, 'action_denied')
    }
    const res = await handleCommand({ action: norm.action, args: norm.args, session })
    // 批填/宏步：扩展层 ok 但 data.ok===false（失败即停）也算停
    const dataOk =
      res.ok &&
      !(
        res.data &&
        typeof res.data === 'object' &&
        (res.data as { ok?: boolean }).ok === false &&
        ((res.data as { batch?: boolean }).batch === true ||
          (res.data as { stoppedAt?: unknown }).stoppedAt != null)
      )
    results.push({ action: norm.action, ...res })
    if (!res.ok || !dataOk) {
      return ok({ stoppedAt: i, results, ok: false, allowWrite })
    }
  }
  return ok({ stoppedAt: null, results, ok: true, allowWrite })
}

export async function handleCommand(msg: BridgeCommand): Promise<CmdResult> {
  const rawAction = String(msg.action || '')
  const { action, args } = normalizeAction(rawAction, msg.args || {})

  if (action === 'list_tabs') {
    await loadAttached()
    await loadSessions()
    const attachedTabId = getAttachedTabId()
    const tabs = await chrome.tabs.query({})
    const data = []
    for (const t of tabs) {
      if (
        t.id == null ||
        !t.url ||
        t.url.startsWith('chrome://') ||
        t.url.startsWith('chrome-extension://') ||
        t.url.startsWith('edge://') ||
        t.url.startsWith('about:')
      ) {
        continue
      }
      const meta = await groupMetaForTab(t.id)
      const ledger = meta.session ? getLedger(meta.session) : null
      data.push({
        tabId: t.id,
        windowId: t.windowId,
        url: t.url,
        title: t.title || '',
        active: !!t.active,
        attached: t.id === attachedTabId,
        groupId: meta.groupId,
        groupTitle: meta.groupTitle,
        session: meta.session,
        borrowed: ledger ? ledger.borrowedTabIds.includes(t.id) : undefined,
      })
    }
    return ok({ tabs: data, attachedTabId, sessions: await listSessionSummary() })
  }
  if (action === 'find_tab') return handleFindTab(args, msg.session)
  if (action === 'run') return handleRun(args, msg.session)
  if (action === 'close_session') {
    const name = String(args?.session || msg.session || '').trim()
    if (!name) return fail('请提供 session（任务名）', 'invalid_arg')
    const res = await closeSession(name)
    return ok(res)
  }
  if (action === 'list_sessions') {
    return ok({ sessions: await listSessionSummary() })
  }
  if (action === 'group_session' || action === 'ensure_group') {
    const groupTitle = String(args?.group_title || args?.groupTitle || msg.session || '舞台任务').trim()
    const sessionName =
      resolveSessionName(String(args?.session || msg.session || ''), groupTitle) || 'ww-task'
    const urlIncludes = String(args?.urlIncludes || args?.url || '').trim()
    if (Array.isArray(args?.tabIds) && (args.tabIds as unknown[]).length) {
      const ids = (args.tabIds as unknown[]).map((x) => Number(x)).filter((n) => n > 0)
      let groupId: number | null = null
      const tabIds: number[] = []
      for (const id of ids) {
        const g = await bindTabToSession(sessionName, id, {
          borrowed: args?.borrowed !== false,
          groupTitle,
          createGroup: true,
        })
        if (g) {
          groupId = g.groupId
          tabIds.push(id)
        }
      }
      return ok({ session: sessionName, groupId, groupTitle, tabIds })
    }
    if (!urlIncludes) {
      return fail('请提供 urlIncludes（如 xiaohongshu.com）或 tabIds[]', 'invalid_arg')
    }
    const res = await groupMatchingTabs(sessionName, groupTitle, urlIncludes, {
      borrowed: args?.borrowed !== false,
    })
    return ok(res)
  }
  if (action === 'attach') {
    const tabId = Number(args?.tabId)
    if (!tabId) return fail('请提供 tabId', 'invalid_arg')
    const tab = await chrome.tabs.get(tabId)
    await saveAttached(tabId)
    await ensureContent(tabId)
    await focusTab(tabId, wantActivateWindow(args))
    const borrowed = args?.borrowed !== false // 附着已有标签默认视为借用
    const g = await bindTabToSession(msg.session, tabId, {
      borrowed,
      createGroup: !!args?.joinGroup,
      groupTitle: String(args?.group_title || args?.groupTitle || ''),
    })
    return ok({
      tabId,
      url: tab.url,
      title: tab.title || '',
      attached: true,
      borrowed,
      session: msg.session || undefined,
      groupId: g?.groupId ?? undefined,
      groupTitle: g?.groupTitle,
    })
  }
  if (action === 'navigate') {
    const url = String(args?.url || '').trim()
    if (!url) return fail('请提供 url', 'invalid_arg')
    let tab: chrome.tabs.Tab
    const current = await resolveTabId()
    const openedNew = !!args?.newTab || !current
    if (args?.newTab) {
      tab = await chrome.tabs.create({ url, active: true })
    } else if (current) {
      tab = await chrome.tabs.update(current, { url, active: true })
    } else {
      tab = await chrome.tabs.create({ url, active: true })
    }
    await saveAttached(tab.id!)
    if (args?.wait !== false) await waitTabComplete(tab.id!, Number(args?.timeoutMs) || 15000)
    // 内联 waitFor*：导航完成后短等正文/控件，避免外面再 browser_wait
    const waitSpec = extractWaitFor(args)
    let navWait: Awaited<ReturnType<typeof probeUntil>> | undefined
    if (waitSpec && tab.id) {
      navWait = await probeUntil(tab.id, waitSpec)
    }
    // 未传 session 时：有 group_title 或 newTab 也自动建组，标签栏才看得到
    const groupTitle =
      String(args?.group_title || args?.groupTitle || '').trim() ||
      (openedNew ? '舞台任务' : '')
    const sessionName = resolveSessionName(msg.session, groupTitle) || (openedNew ? 'ww-task' : '')
    const g = sessionName
      ? await bindTabToSession(sessionName, tab.id!, {
          borrowed: false,
          createGroup: true,
          groupTitle: groupTitle || sessionName,
        })
      : null
    let navData: Record<string, unknown> = {
      tabId: tab.id,
      url: tab.url || url,
      title: tab.title || '',
      newTab: openedNew,
      session: g?.session || sessionName || undefined,
      groupId: g?.groupId ?? undefined,
      groupTitle: g?.groupTitle,
    }
    if (navWait) navData.wait = navWait
    // navigate：有 waitFor 默认 probe；显式 observation=ax / includeSnapshot=true 才全量
    if (tab.id) {
      const wantAx =
        args.includeSnapshot === true ||
        args.include_snapshot === true ||
        args.observation === 'ax' ||
        args.observation === 'full'
      const wantProbe = !!navWait || args.observation === 'probe' || args.includeSnapshot === 'probe'
      if (wantAx || wantProbe) {
        navData = await maybeAttachSnapshot(tab.id, args, navData, {
          defaultMode: wantAx ? 'ax' : 'probe',
          settleMs: navWait?.matched ? 0 : 40,
        })
      }
    }
    return ok(navData)
  }
  if (action === 'select_option') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    return handleSelectOption(tid, args)
  }
  if (action === 'drag') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    return handleDrag(tid, args)
  }
  // 默认 CDP AX 快照（对齐 Kimi）；source=dom / frame 非主文档时回退 content
  if (action === 'snapshot') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    await ensureContent(tid)
    const ax = await handleAxSnapshot(tid, args)
    if (ax.ok) return ax
    if ((ax as { code?: string }).code !== 'use_dom') return ax
    return withPage('snapshot', { ...args, format: args.format || 'aria' })
  }
  if (action === 'find') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    await ensureContent(tid)
    const ax = await handleAxFind(tid, args)
    if (ax.ok) return ax
    if ((ax as { code?: string }).code !== 'use_dom') {
      // AX find 失败时仍试 DOM
      const dom = await withPage('find', args)
      if (dom.ok) return dom
      return ax
    }
    return withPage('find', args)
  }
  if (action === 'fill') {
    const batch = await tryHandleFillFields(args, (one) => withPage('fill', one, { focus: true }))
    if (batch) return batch
    let res = await withPage('fill', args, { focus: true })
    const tid = await resolveTabId()
    if (tid) res = await finishSingleFill(tid, args, res)
    return res
  }
  if (PAGE_ACTIONS.has(action)) {
    const needFocus = action === 'keys'
    return withPage(action, args, { focus: needFocus })
  }
  if (action === 'click') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    return handleClick(tid, args)
  }
  if (action === 'upload') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    return handleUpload(tid, args)
  }
  if (action === 'network') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    return handleNetwork(tid, args)
  }
  if (action === 'wait') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    return handleWait(tid, args)
  }
  if (action === 'screenshot') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    await focusTab(tid, wantActivateWindow(args))
    try {
      const tab = await chrome.tabs.get(tid)
      await ensureContent(tid)
      const vp = await sendToTab(tid, 'viewport', {})
      const format = String(args?.format || 'jpeg').toLowerCase() === 'png' ? 'png' : 'jpeg'
      const quality = Math.min(100, Math.max(40, Number(args?.quality) || 62))
      const opts =
        format === 'png'
          ? ({ format: 'png' } as chrome.tabs.CaptureVisibleTabOptions)
          : ({ format: 'jpeg', quality } as chrome.tabs.CaptureVisibleTabOptions)
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, opts)
      return ok({
        dataUrl,
        format,
        quality: format === 'jpeg' ? quality : undefined,
        url: tab.url || '',
        title: tab.title || '',
        tabId: tid,
        viewport: vp?.ok ? vp.data : undefined,
      })
    } catch (e) {
      return fail('截图失败: ' + String((e as Error)?.message || e), 'screenshot_failed')
    }
  }
  if (action === 'open_frame') {
    const tid = await resolveTabId()
    if (!tid) return fail('没有可操作的标签：请先 attach / find_tab / navigate', 'no_tab')
    const frameId = String(args?.frame || args?.id || '').trim()
    if (!frameId) return fail('请提供 frame（如 #f1）', 'invalid_arg')
    await ensureContent(tid)
    const framesRes = await sendToTab(tid, 'frames', {})
    if (!framesRes?.ok) return fail(framesRes?.error || '无法读取 frames', 'frames_failed')
    const list = (framesRes.data?.frames || []) as Array<{
      id: string
      url?: string
      sameOrigin?: boolean
      root?: boolean
    }>
    const f = list.find((x) => x.id === frameId)
    if (!f) return fail('未找到 ' + frameId + '，请先 snapshot', 'not_found')
    if (f.root) return fail('#f0 已是主文档，无需 open_frame', 'invalid_arg')
    if (f.sameOrigin && !args?.forceNewTab) {
      return ok({
        opened: false,
        sameOrigin: true,
        frame: f.id,
        url: f.url,
        note: '同域 iframe：直接 snapshot/click 时传 frame=' + f.id,
      })
    }
    const url = String(f.url || '').trim()
    if (!url || url.startsWith('about:') || url.startsWith('javascript:')) {
      return fail('该 frame 无可用 http(s) URL，无法新开标签', 'invalid_url')
    }
    const tab = await chrome.tabs.create({ url, active: true })
    await saveAttached(tab.id!)
    await waitTabComplete(tab.id!, 15000)
    await ensureContent(tab.id!)
    const g = await bindTabToSession(msg.session, tab.id!, {
      borrowed: false,
      createGroup: true,
      groupTitle: String(args?.group_title || args?.groupTitle || ''),
    })
    return ok({
      opened: true,
      tabId: tab.id,
      url: tab.url || url,
      title: tab.title || '',
      fromFrame: frameId,
      attached: true,
      session: msg.session || undefined,
      groupId: g?.groupId ?? undefined,
      groupTitle: g?.groupTitle,
    })
  }
  if (action === 'record_start') {
    const res = await startRecording({
      title: typeof args?.title === 'string' ? args.title : '',
      tabId: typeof args?.tabId === 'number' ? args.tabId : undefined,
    })
    if (!res.ok) return fail(res.error, res.code || 'record_failed')
    return ok(res.data)
  }
  if (action === 'record_stop') {
    const res = await stopRecording()
    return ok(res.data)
  }
  if (action === 'record_status') {
    return ok(getRecordState())
  }
  if (action === 'status') {
    await loadAttached()
    const rec = recordStatusExtra()
    return ok({
      extensionConnected: true,
      attachedTabId: rec.attachedTabId ?? getAttachedTabId(),
      version: EXT_VERSION,
      capabilities: [...CAPABILITIES],
      session: msg.session || undefined,
      sessions: await listSessionSummary(),
      recording: rec.recording,
      recordingSession: rec.recordingSession,
    })
  }
  // 热重载：seed/构建更新后由 Host 或 Agent 触发，无需打开 chrome://extensions
  if (action === 'reload_extension') {
    setTimeout(() => {
      try {
        chrome.runtime.reload()
      } catch {
        /* ignore */
      }
    }, 50)
    return ok({ reloading: true, version: EXT_VERSION })
  }
  return fail('未知动作: ' + action, 'unknown_action')
}

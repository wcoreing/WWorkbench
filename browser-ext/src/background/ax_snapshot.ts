/**
 * CDP Accessibility.getFullAXTree 快照（对齐 Kimi WebBridge）。
 * 交互节点分配 @eN，并 stamp data-ww-ref，供 content 脚本 click/fill 复用。
 */
import { withDebugger } from './debugger'
import { fail, ok, type CmdResult } from '../shared/types'
import { ensureContent, sendToTab } from './tabs'

export type AxRefEntry = {
  backendDOMNodeId: number
  role: string
  name: string
}

type AxNode = {
  nodeId: string
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  description?: { value?: string }
  backendDOMNodeId?: number
  childIds?: string[]
}

export type AxTreeNode = {
  role: string
  name?: string
  value?: string
  description?: string
  ref?: string
  children?: AxTreeNode[]
}

/** 与 Kimi 一致的可交互 role，另加 gridcell（日期格）。 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
  'gridcell',
])

const axRefs = new Map<string, AxRefEntry>()
let axSeq = 1
let lastFlat: Array<{ ref: string; role: string; name: string; value?: string }> = []
let lastMeta: { url: string; title: string; tabId: number } | null = null

export function clearAxRefs() {
  axRefs.clear()
  axSeq = 1
  lastFlat = []
  lastMeta = null
}

export function getAxRef(ref: string | undefined | null): AxRefEntry | null {
  if (!ref) return null
  const key = String(ref).startsWith('@') ? String(ref).slice(1) : String(ref)
  return axRefs.get(key) || null
}

export function hasAxRef(ref: string | undefined | null): boolean {
  return !!getAxRef(ref)
}

function allocRef(backendDOMNodeId: number, role: string, name: string): string {
  const id = `e${axSeq++}`
  axRefs.set(id, { backendDOMNodeId, role, name })
  return id
}

function flattenTree(nodes: AxTreeNode[]): Array<{ ref: string; role: string; name: string; value?: string }> {
  const out: Array<{ ref: string; role: string; name: string; value?: string }> = []
  const walk = (n: AxTreeNode | AxTreeNode[] | undefined) => {
    if (!n) return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (n.ref) {
      out.push({ ref: n.ref, role: n.role, name: n.name || '', value: n.value })
    }
    if (n.children?.length) walk(n.children)
  }
  walk(nodes)
  return out
}

function formatChildren(root: AxNode, byId: Map<string, AxNode>): AxTreeNode[] {
  const out: AxTreeNode[] = []
  const format = (node: AxNode): AxTreeNode | AxTreeNode[] | null => {
    const role = node.role?.value
    if (!role || role === 'none' || role === 'generic') {
      if (!node.childIds?.length) return null
      const kids: AxTreeNode[] = []
      for (const cid of node.childIds) {
        const child = byId.get(cid)
        if (!child) continue
        const t = format(child)
        if (!t) continue
        if (Array.isArray(t)) kids.push(...t)
        else kids.push(t)
      }
      if (kids.length === 1) return kids[0]
      return kids.length > 0 ? kids : null
    }
    const item: AxTreeNode = { role }
    if (node.name?.value) item.name = node.name.value
    if (node.value?.value != null && String(node.value.value) !== '') item.value = String(node.value.value)
    if (node.description?.value) item.description = node.description.value
    if (INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId != null) {
      item.ref = `@${allocRef(node.backendDOMNodeId, role, item.name || '')}`
    }
    if (node.childIds?.length) {
      const kids: AxTreeNode[] = []
      for (const cid of node.childIds) {
        const child = byId.get(cid)
        if (!child) continue
        const t = format(child)
        if (!t) continue
        if (Array.isArray(t)) kids.push(...t)
        else kids.push(t)
      }
      if (kids.length) item.children = kids
    }
    return item
  }

  if (root.childIds) {
    for (const cid of root.childIds) {
      const child = byId.get(cid)
      if (!child) continue
      const t = format(child)
      if (!t) continue
      if (Array.isArray(t)) out.push(...t)
      else out.push(t)
    }
  }
  return out
}

function buildTree(nodes: AxNode[]): AxTreeNode[] {
  if (!nodes.length) return []
  const byId = new Map<string, AxNode>()
  for (const n of nodes) byId.set(n.nodeId, n)
  return formatChildren(nodes[0], byId)
}

function treeTextFromFlat(
  flat: Array<{ ref: string; role: string; name: string; value?: string }>,
  maxChars: number,
): { text: string; truncated: boolean } {
  const lines = flat.map((n) => {
    const bits = [n.ref, n.role, JSON.stringify(n.name || '')]
    if (n.value) bits.push('value=' + JSON.stringify(String(n.value).slice(0, 60)))
    return bits.join(' ')
  })
  let text = lines.join('\n')
  let truncated = false
  if (text.length > maxChars) {
    text = text.slice(0, maxChars)
    truncated = true
  }
  return { text, truncated }
}

/** 把 @eN stamp 到 DOM，便于 content 脚本 resolve。 */
async function stampRefs(
  target: { tabId: number },
  entries: Array<{ ref: string; backendDOMNodeId: number }>,
) {
  for (const e of entries) {
    try {
      const resolved = (await chrome.debugger.sendCommand(target, 'DOM.resolveNode', {
        backendNodeId: e.backendDOMNodeId,
      })) as { object?: { objectId?: string } }
      const objectId = resolved?.object?.objectId
      if (!objectId) continue
      await chrome.debugger.sendCommand(target, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(ref) {
          try {
            this.setAttribute('data-ww-ref', ref);
            return true;
          } catch (e) { return false; }
        }`,
        arguments: [{ value: e.ref }],
        returnByValue: true,
      })
    } catch {
      /* 节点可能不可解析（跨域/已卸） */
    }
  }
}

/**
 * DOM 补充：AX 未收录但 interactiveList 能扫到的节点（如 Label Studio 芯片）。
 * 不擦除已 stamp 的 AX refs。
 */
async function supplementDomRefs(
  tabId: number,
  startSeq: number,
  limit: number,
): Promise<Array<{ ref: string; role: string; name: string; value?: string }>> {
  const res = await sendToTab(tabId, 'ax_supplement', { startSeq, limit })
  if (!res?.ok || !Array.isArray(res.data?.nodes)) return []
  const nodes = res.data.nodes as Array<{
    ref: string
    role: string
    name: string
    value?: string
    backendHint?: boolean
  }>
  for (const n of nodes) {
    const key = n.ref.startsWith('@') ? n.ref.slice(1) : n.ref
    const num = parseInt(key.replace(/^e/, ''), 10)
    if (Number.isFinite(num) && num >= axSeq) axSeq = num + 1
    // DOM 补充没有 backendDOMNodeId；click 走 content data-ww-ref
    if (!axRefs.has(key)) {
      axRefs.set(key, { backendDOMNodeId: 0, role: n.role, name: n.name || '' })
    }
  }
  return nodes.map((n) => ({
    ref: n.ref,
    role: n.role,
    name: n.name || '',
    value: n.value,
  }))
}

export async function handleAxSnapshot(tabId: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const source = String(args.source || args.mode || 'ax').toLowerCase()
  // 显式 DOM / 带 frame：回退 content 快照
  if (source === 'dom' || (args.frame && String(args.frame) !== '' && String(args.frame) !== '#f0')) {
    return fail('use_dom', 'use_dom')
  }

  clearAxRefs()
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch (e) {
    return fail('无法读取标签: ' + String((e as Error)?.message || e), 'no_tab')
  }

  try {
    const tree = await withDebugger(tabId, async (target) => {
      // 先清旧 stamp，避免脏 ref
      await chrome.debugger
        .sendCommand(target, 'Runtime.evaluate', {
          expression: `document.querySelectorAll('[data-ww-ref]').forEach(n=>n.removeAttribute('data-ww-ref'))`,
          returnByValue: true,
        })
        .catch(() => {})

      const ax = (await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree', {})) as {
        nodes?: AxNode[]
      }
      const built = buildTree(ax.nodes || [])
      const stampList: Array<{ ref: string; backendDOMNodeId: number }> = []
      for (const [key, entry] of axRefs) {
        if (entry.backendDOMNodeId > 0) {
          stampList.push({ ref: `@${key}`, backendDOMNodeId: entry.backendDOMNodeId })
        }
      }
      await stampRefs(target, stampList)
      return built
    })

    let flat = flattenTree(tree)
    const format = String(args.format || 'aria').toLowerCase()
    const maxNodes = Math.max(20, Math.min(Number(args.maxNodes || args.max_nodes) || (format === 'json' ? 280 : 220), 500))
    const maxChars = Math.max(200, Math.min(Number(args.maxChars || args.max_chars) || 12000, 60000))

    // DOM 补充（标注芯片等无 ARIA role 的可点节点）
    if (args.supplement !== false) {
      const extra = await supplementDomRefs(tabId, axSeq, Math.max(0, maxNodes - flat.length))
      if (extra.length) flat = flat.concat(extra)
    }

    const truncatedNodes = flat.length > maxNodes
    const limited = flat.slice(0, maxNodes)
    lastFlat = limited
    lastMeta = { url: tab.url || '', title: tab.title || '', tabId }

    const { text, truncated: truncatedText } = treeTextFromFlat(limited, maxChars)
    const base = {
      url: tab.url || '',
      title: tab.title || '',
      frame: '#f0',
      source: 'ax',
      nodeCount: limited.length,
      truncated: truncatedNodes || truncatedText,
    }

    if (format === 'json') {
      return ok({
        ...base,
        nodes: limited.map((n) => ({
          ref: n.ref,
          role: n.role,
          name: n.name,
          value: n.value,
          frame: '#f0',
        })),
        tree,
      })
    }

    // aria / text：Kimi 风格紧凑树
    return ok({
      ...base,
      format: 'aria',
      tree_text: text,
      tree,
    })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    // debugger 不可用时交还 DOM 路径
    if (/Cannot access|Debugger is not attached|Another debugger|Detached|Protocol error/i.test(msg)) {
      return fail(msg, 'use_dom')
    }
    return fail('AX 快照失败: ' + msg, 'ax_snapshot_failed')
  }
}

export async function handleAxFind(tabId: number, args: Record<string, unknown> = {}): Promise<CmdResult> {
  const q = String(args.query || args.nameIncludes || '')
    .trim()
    .toLowerCase()
  if (!q) return fail('请提供 query', 'invalid_arg')

  // 无缓存或标签变了则重拍
  if (!lastMeta || lastMeta.tabId !== tabId || lastFlat.length === 0) {
    const snap = await handleAxSnapshot(tabId, { ...args, format: 'json' })
    if (!snap.ok) return snap
  }

  const matches = lastFlat.filter(
    (n) =>
      (n.name || '').toLowerCase().includes(q) ||
      (n.ref || '').toLowerCase().includes(q) ||
      (n.role || '').toLowerCase().includes(q),
  )
  return ok({
    query: q,
    matches,
    totalMatches: matches.length,
    url: lastMeta?.url || '',
    title: lastMeta?.title || '',
    frame: '#f0',
    source: 'ax',
  })
}

/** observation 分级：off | probe（轻确认）| ax（全量树，可继续点 @eN）。 */
export type ObservationMode = 'off' | 'probe' | 'ax'

/**
 * 解析 observation / includeSnapshot。
 * - false → off
 * - "probe"|"light" → probe
 * - true|"ax" → ax
 * - 未传：用 defaultMode
 */
export function resolveObservationMode(
  args: Record<string, unknown>,
  defaultMode: ObservationMode = 'ax',
): ObservationMode {
  const raw = args.observation ?? args.includeSnapshot ?? args.include_snapshot
  if (raw === false || raw === 'false' || raw === 0 || raw === 'off' || raw === 'none') return 'off'
  if (raw === 'probe' || raw === 'light') return 'probe'
  if (raw === true || raw === 'true' || raw === 1 || raw === 'ax' || raw === 'full') return 'ax'
  return defaultMode
}

/**
 * 写操作后附带 observation。
 * ax：精简 aria tree_text；probe：只回 wait/probe 结果（快）。
 */
export async function maybeAttachSnapshot(
  tabId: number,
  args: Record<string, unknown>,
  data: Record<string, unknown>,
  opts?: { defaultMode?: ObservationMode; settleMs?: number },
): Promise<Record<string, unknown>> {
  const mode = resolveObservationMode(args, opts?.defaultMode ?? 'ax')
  if (mode === 'off') return data

  if (mode === 'probe') {
    // 优先复用已有 wait；否则只回 url/title 轻量信息
    const w = data.wait as
      | { matched?: boolean; waitedMs?: number; probe?: Record<string, unknown> }
      | undefined
    if (w?.probe) {
      return {
        ...data,
        observation: {
          kind: 'probe',
          matched: w.matched,
          waitedMs: w.waitedMs,
          ...w.probe,
        },
      }
    }
    try {
      await ensureContent(tabId)
      const res = await sendToTab(tabId, 'probe', { readyState: true })
      return {
        ...data,
        observation: {
          kind: 'probe',
          matched: !!res?.ok && !!res.data?.matched,
          ...(res?.data || {}),
        },
      }
    } catch {
      return { ...data, observation: { kind: 'probe', matched: false } }
    }
  }

  // ax：全量
  const settle = opts?.settleMs != null ? opts.settleMs : 100
  if (settle > 0) await new Promise((r) => setTimeout(r, settle))
  const snap = await handleAxSnapshot(tabId, {
    format: 'aria',
    maxNodes: Number(args.snapshotMaxNodes || args.maxNodes) || 160,
    maxChars: Number(args.snapshotMaxChars || args.maxChars) || 8000,
  })
  if (snap.ok) {
    const obs = snap.data as Record<string, unknown>
    const { tree: _tree, ...light } = obs as { tree?: unknown }
    return { ...data, observation: { kind: 'ax', ...light } }
  }
  return {
    ...data,
    observationError: (snap as { error?: string }).error || 'snapshot_failed',
  }
}

/** CDP：按 AX ref 取点击盒。 */
export async function resolveAxBox(
  tabId: number,
  ref: string,
): Promise<{ x: number; y: number; width: number; height: number; via: string; label?: string } | null> {
  const entry = getAxRef(ref)
  if (!entry || !entry.backendDOMNodeId) return null
  return withDebugger(tabId, async (target) => {
    try {
      const model = (await chrome.debugger.sendCommand(target, 'DOM.getBoxModel', {
        backendNodeId: entry.backendDOMNodeId,
      })) as { model?: { content: number[] } }
      const c = model?.model?.content
      if (!c || c.length < 8) return null
      const xs = [c[0], c[2], c[4], c[6]]
      const ys = [c[1], c[3], c[5], c[7]]
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      // 滚入视口
      const resolved = (await chrome.debugger.sendCommand(target, 'DOM.resolveNode', {
        backendNodeId: entry.backendDOMNodeId,
      })) as { object?: { objectId?: string } }
      if (resolved?.object?.objectId) {
        await chrome.debugger.sendCommand(target, 'Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: `function(){ this.scrollIntoView({block:'center',inline:'center'}); }`,
          returnByValue: true,
        })
        const model2 = (await chrome.debugger.sendCommand(target, 'DOM.getBoxModel', {
          backendNodeId: entry.backendDOMNodeId,
        })) as { model?: { content: number[] } }
        const c2 = model2?.model?.content
        if (c2 && c2.length >= 8) {
          const xs2 = [c2[0], c2[2], c2[4], c2[6]]
          const ys2 = [c2[1], c2[3], c2[5], c2[7]]
          const minX2 = Math.min(...xs2)
          const maxX2 = Math.max(...xs2)
          const minY2 = Math.min(...ys2)
          const maxY2 = Math.max(...ys2)
          return {
            x: (minX2 + maxX2) / 2,
            y: (minY2 + maxY2) / 2,
            width: maxX2 - minX2,
            height: maxY2 - minY2,
            via: 'ax_ref',
            label: entry.name,
          }
        }
      }
      return {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        width: maxX - minX,
        height: maxY - minY,
        via: 'ax_ref',
        label: entry.name,
      }
    } catch {
      return null
    }
  })
}

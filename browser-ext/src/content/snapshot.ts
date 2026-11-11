/** 快照 / find / 读正文。 */
import { deepQuery, deepQueryAll, interactiveList, labelOf, roleOf, visible } from './dom'
import { listFrames, resolveContext } from './frames'

export function buildSnapshot(args) {
  const ctx = resolveContext(args || {})
  const { doc, frame } = ctx
  const format = String(args?.format || 'json').toLowerCase()
  // 日期面板打开时日格多，默认配额抬高，避免只剩侧栏
  const hasDateOverlay = !!document.querySelector(
    '.el-picker__popper:not([aria-hidden="true"]) .el-date-table, .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  )
  const defaultLimit = format === 'aria' ? (hasDateOverlay ? 160 : 80) : hasDateOverlay ? 200 : 120
  const limit = Math.max(20, Math.min(args?.maxNodes || defaultLimit, 400))
  const nodes = []
  const list = interactiveList(doc)
  deepQueryAll(doc, '[data-ww-ref]').forEach((n) => n.removeAttribute('data-ww-ref'))
  let i = 0
  for (const el of list) {
    if (nodes.length >= limit) break
    i += 1
    const ref = `@e${i}`
    el.setAttribute('data-ww-ref', ref)
    const node = {
      ref,
      role: roleOf(el),
      name: labelOf(el),
      tag: el.tagName.toLowerCase(),
      type: el.type || undefined,
      value: typeof el.value === 'string' ? el.value.slice(0, 60) : undefined,
      frame,
      shadow: !!el.getRootNode?.()?.host,
    }
    if (node.role === 'gridcell' && el.getAttribute('title')) {
      node.title = String(el.getAttribute('title')).slice(0, 32)
    }
    if (el.tagName === 'SELECT') {
      node.options = [...(el.options || [])].slice(0, 30).map((o) => ({
        value: String(o.value || '').slice(0, 80),
        label: String(o.text || o.label || '').slice(0, 80),
        selected: !!o.selected,
      }))
    }
    nodes.push(node)
  }
  const frames = listFrames()
  const base = {
    url: doc.location?.href || location.href,
    title: doc.title || document.title,
    frame,
    frames,
    truncated: list.length > nodes.length,
  }
  // Kimi 风格：format=aria 返回紧凑文本树，少占 token、响应更快
  if (format === 'aria' || format === 'text') {
    const lines = nodes.map((n) => {
      const bits = [n.ref, n.role, JSON.stringify(n.name || '')]
      if (n.value) bits.push('value=' + JSON.stringify(n.value))
      return bits.join(' ')
    })
    let treeText = lines.join('\n')
    const maxChars = Math.max(200, Math.min(Number(args?.maxChars) || 12000, 60000))
    let truncatedText = false
    if (treeText.length > maxChars) {
      treeText = treeText.slice(0, maxChars)
      truncatedText = true
    }
    return {
      ...base,
      format: 'aria',
      tree_text: treeText,
      nodeCount: nodes.length,
      truncated: base.truncated || truncatedText,
    }
  }
  return { ...base, nodes }
}

export function findByRef(doc, ref) {
  if (!ref) return null
  const safe = String(ref).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const el = deepQuery(doc, `[data-ww-ref="${safe}"]`)
  if (el) return el
  const m = String(ref).match(/^@e(\d+)$/)
  if (!m) return null
  const idx = parseInt(m[1], 10) - 1
  return interactiveList(doc)[idx] || null
}

export function findTarget(doc, args) {
  if (args?.ref) {
    const byRef = findByRef(doc, args.ref)
    if (byRef) return byRef
  }
  if (args?.selector) {
    try {
      return deepQuery(doc, args.selector) || doc.querySelector(args.selector)
    } catch {
      return null
    }
  }
  return null
}

export function doFind(args) {
  const snap = buildSnapshot(args || {})
  const q = String(args?.query || args?.nameIncludes || '')
    .trim()
    .toLowerCase()
  if (!q) return { ok: false, error: '请提供 query' }
  const matches = snap.nodes.filter(
    (n) =>
      (n.name || '').toLowerCase().includes(q) ||
      (n.ref || '').toLowerCase().includes(q) ||
      (n.role || '').toLowerCase().includes(q),
  )
  return {
    ok: true,
    data: {
      query: q,
      matches,
      totalMatches: matches.length,
      url: snap.url,
      title: snap.title,
      frame: snap.frame,
      frames: snap.frames,
    },
  }
}

export function pageHasText(doc, text) {
  if (!text) return false
  try {
    return (doc.body?.innerText || '').includes(text)
  } catch {
    return false
  }
}

export function doReadPage(args) {
  const ctx = resolveContext(args || {})
  const { doc, frame } = ctx
  const maxChars = Math.max(200, Math.min(Number(args?.maxChars) || 8000, 60000))
  const start = Math.max(0, Number(args?.start) || 0)
  const raw = (doc.body?.innerText || doc.documentElement?.innerText || '').replace(/\r/g, '')
  const text = raw.slice(start, start + maxChars)
  const next = start + text.length
  const complete = next >= raw.length
  return {
    ok: true,
    data: {
      text,
      complete,
      nextStart: complete ? undefined : next,
      start,
      totalChars: raw.length,
      url: doc.location?.href || location.href,
      title: doc.title || document.title,
      frame,
      note: complete ? undefined : '未读完：把 nextStart 作为 start 继续 read_page',
    },
  }
}

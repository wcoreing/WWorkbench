/** wait/probe 条件。 */
import { visible } from './dom'
import { resolveContext } from './frames'
import { buildSnapshot, doFind, findTarget, pageHasText } from './snapshot'

export function doProbe(args) {
  const ctx = resolveContext(args || {})
  const { doc, frame } = ctx
  const url = doc.location?.href || location.href
  const title = doc.title || document.title
  if (args?.readyState || args?.loadComplete) {
    const ready = (doc.readyState || '') === 'complete'
    return { ok: true, data: { matched: ready, kind: 'readyState', readyState: doc.readyState, url, title, frame } }
  }
  if (args?.text != null && String(args.text) !== '') {
    return { ok: true, data: { matched: pageHasText(doc, String(args.text)), kind: 'text', url, title, frame } }
  }
  if (args?.textGone != null && String(args.textGone) !== '') {
    return {
      ok: true,
      data: { matched: !pageHasText(doc, String(args.textGone)), kind: 'textGone', url, title, frame },
    }
  }
  if (args?.nameIncludes) {
    const found = doFind({ ...args, query: args.nameIncludes })
    if (!found.ok) return found
    return {
      ok: true,
      data: {
        matched: found.data.totalMatches > 0,
        kind: 'nameIncludes',
        matches: found.data.matches.slice(0, 12),
        url,
        title,
        frame,
      },
    }
  }
  if (args?.ref || args?.selector) {
    buildSnapshot({ ...args, maxNodes: args?.maxNodes || 200 })
    const el = findTarget(doc, args)
    return {
      ok: true,
      data: { matched: !!(el && visible(el)), kind: args.ref ? 'ref' : 'selector', url, title, frame },
    }
  }
  return { ok: false, error: 'wait/probe 请提供 text、textGone、nameIncludes、ref、selector 或 readyState' }
}


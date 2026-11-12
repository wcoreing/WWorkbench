/** 共享 debugger 附着，避免各处重复 attach/detach。 */
export async function withDebugger<T>(tabId: number, fn: (target: { tabId: number }) => Promise<T>): Promise<T> {
  const target = { tabId }
  let attachedHere = false
  try {
    await chrome.debugger.attach(target, '1.3')
    attachedHere = true
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!/Already attached/i.test(msg)) throw e
  }
  try {
    return await fn(target)
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(target)
      } catch {
        /* ignore */
      }
    }
  }
}

export async function debuggerMouseClick(tabId: number, box: { x: number; y: number }) {
  await withDebugger(tabId, async (target) => {
    const x = Math.round(Number(box.x))
    const y = Math.round(Number(box.y))
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    })
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  })
}

export async function debuggerMouseDrag(
  tabId: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) {
  await withDebugger(tabId, async (target) => {
    const x0 = Math.round(Number(from.x))
    const y0 = Math.round(Number(from.y))
    const x1 = Math.round(Number(to.x))
    const y1 = Math.round(Number(to.y))
    const n = Math.min(Math.max(Number(steps) || 12, 3), 40)
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x0,
      y: y0,
      button: 'none',
    })
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: x0,
      y: y0,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const x = Math.round(x0 + (x1 - x0) * t)
      const y = Math.round(y0 + (y1 - y0) * t)
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'left',
        buttons: 1,
      })
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: x1,
      y: y1,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  })
}

type CdpBox = { x: number; y: number; width: number; height: number; via: string; label?: string }
type CdpTarget = { tabId: number }

type DomNodeBrief = {
  nodeId?: number
  backendNodeId?: number
  nodeName?: string
  localName?: string
  parentId?: number
  attributes?: string[]
}

function boxFromContent(content: number[], via: string, label?: string): CdpBox | null {
  if (!content || content.length < 8) return null
  const xs = [content[0], content[2], content[4], content[6]]
  const ys = [content[1], content[3], content[5], content[7]]
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  if (width <= 0 || height <= 0) return null
  return {
    x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4,
    y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4,
    width,
    height,
    via,
    label,
  }
}

function attrMap(attrs?: string[]) {
  const m: Record<string, string> = {}
  if (!attrs) return m
  for (let i = 0; i + 1 < attrs.length; i += 2) m[attrs[i]] = attrs[i + 1]
  return m
}

function isClickableNode(node: DomNodeBrief): boolean {
  const tag = String(node.localName || node.nodeName || '').toLowerCase()
  if (tag === 'button' || tag === 'a' || tag === 'summary') return true
  const attrs = attrMap(node.attributes)
  const role = (attrs.role || '').toLowerCase()
  if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') return true
  const cls = ` ${attrs.class || attrs.className || ''} `
  if (/\bbtn\b|\bbutton\b|\bce-btn\b/i.test(cls)) return true
  return false
}

function clickScore(box: CdpBox, node: DomNodeBrief): number {
  let s = Math.min(box.width, 400) * Math.min(box.height, 120)
  const tag = String(node.localName || node.nodeName || '').toLowerCase()
  if (tag === 'button') s += 50_000
  else if (isClickableNode(node)) s += 20_000
  // 文案节点盒子偏小，降权（上次失败：80×28 文本 vs 120×40 按钮）
  if (tag === '#text' || tag === 'span' || tag === 'label') s *= 0.25
  if (box.width >= 60 && box.height >= 28) s += 8_000
  return s
}

async function describeNode(
  target: CdpTarget,
  opts: { nodeId?: number; backendNodeId?: number },
): Promise<DomNodeBrief | null> {
  try {
    const res = (await chrome.debugger.sendCommand(target, 'DOM.describeNode', {
      ...opts,
      depth: 0,
    })) as { node?: DomNodeBrief }
    return res?.node || null
  } catch {
    return null
  }
}

async function boxForNode(
  target: CdpTarget,
  opts: { nodeId?: number; backendNodeId?: number },
  via: string,
  label?: string,
): Promise<{ box: CdpBox; node: DomNodeBrief } | null> {
  try {
    const model = (await chrome.debugger.sendCommand(target, 'DOM.getBoxModel', opts)) as {
      model?: { content: number[] }
    }
    const box = boxFromContent(model?.model?.content || [], via, label)
    if (!box) return null
    const node = (await describeNode(target, opts)) || {}
    return { box, node }
  } catch {
    return null
  }
}

function isInlineOrText(node: DomNodeBrief): boolean {
  const tag = String(node.localName || node.nodeName || '').toLowerCase()
  return tag === '#text' || tag === 'span' || tag === 'label' || tag === 'i' || tag === 'svg' || tag === 'path'
}

/** 从文本/内层节点向上提升到可点击宿主（button / role=button / .btn / 明显更大的父盒）。 */
async function promoteToClickable(
  target: CdpTarget,
  start: { nodeId?: number; backendNodeId?: number },
  via: string,
  label?: string,
): Promise<CdpBox | null> {
  let cur = await boxForNode(target, start, via, label)
  if (!cur) return null
  let best = cur
  const startArea = Math.max(1, cur.box.width * cur.box.height)
  for (let i = 0; i < 10; i++) {
    if (isClickableNode(cur.node) && cur.box.width >= 40 && cur.box.height >= 20) {
      return { ...cur.box, via: via + '_host', label }
    }
    // 文案/图标节点：父盒明显更大且高度像控件 → 视为点击宿主（草稿箱 chip、闭包按钮内层）
    if (
      isInlineOrText(best.node) &&
      cur.box.width * cur.box.height >= startArea * 1.8 &&
      cur.box.height >= 24 &&
      cur.box.height <= 72 &&
      cur.box.width >= 48 &&
      cur.box.width <= 480
    ) {
      best = cur
      return { ...cur.box, via: via + '_host', label }
    }
    if (clickScore(cur.box, cur.node) > clickScore(best.box, best.node)) best = cur
    const parentId = cur.node.parentId
    if (!parentId) break
    const next = await boxForNode(target, { nodeId: parentId }, via, label)
    if (!next) break
    cur = next
  }
  if (isClickableNode(best.node) || best.box.width * best.box.height >= 40 * 24) {
    return { ...best.box, via: via + (isClickableNode(best.node) || best.box.width > startArea ** 0.5 * 1.5 ? '_host' : ''), label }
  }
  return { ...best.box, via, label }
}

async function searchSelectorBoxes(target: CdpTarget, selector: string): Promise<CdpBox | null> {
  const queries = [selector]
  // class 选择器同时试 button.xxx，提高命中真按钮概率
  if (selector.startsWith('.') && !selector.includes(' ')) {
    queries.unshift(`button${selector}`)
  }
  let best: { box: CdpBox; score: number } | null = null
  for (const query of queries) {
    try {
      const search = (await chrome.debugger.sendCommand(target, 'DOM.performSearch', {
        query,
        includeUserAgentShadowDOM: true,
      })) as { searchId: string; resultCount: number }
      if (!search?.resultCount) continue
      const results = (await chrome.debugger.sendCommand(target, 'DOM.getSearchResults', {
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: Math.min(search.resultCount, 12),
      })) as { nodeIds: number[] }
      await chrome.debugger.sendCommand(target, 'DOM.discardSearchResults', { searchId: search.searchId }).catch(() => {})
      for (const nodeId of results?.nodeIds || []) {
        const promoted = await promoteToClickable(target, { nodeId }, 'cdp_search')
        if (!promoted) continue
        const hostBonus = promoted.via.includes('_host') ? 50_000 : 0
        const score = Math.min(promoted.width, 400) * Math.min(promoted.height, 120) + hostBonus
        if (!best || score > best.score) best = { box: promoted, score }
      }
      if (best && best.score >= 20_000) return best.box
    } catch {
      /* try next query */
    }
  }
  return best?.box || null
}

/**
 * Closed Shadow / 深层节点：performSearch（含 shadow）优先找可点击宿主；
 * AX 名称兜底时同样向上提升到 button，避免点到「发布」文本节点却不触发提交。
 */
export async function cdpResolveBox(
  tabId: number,
  args: { selector?: string; name?: string; query?: string; text?: string },
): Promise<CdpBox | null> {
  return withDebugger(tabId, async (target) => {
    const selector = String(args.selector || '').trim()
    if (selector) {
      const hit = await searchSelectorBoxes(target, selector)
      if (hit) return hit
    }

    const name = String(args.name || args.query || args.text || '').trim()
    if (!name) return null

    // 名称再走一遍 performSearch（含 shadow 文本），与 AX 互补；小红书草稿箱/发布钮常在自定义节点里
    try {
      const byText = await searchSelectorBoxes(target, name)
      if (byText && (byText.via.includes('_host') || byText.width >= 60)) return { ...byText, label: name }
    } catch {
      /* AX fallback */
    }

    const ax = (await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree', {})) as {
      nodes?: Array<{
        role?: { value?: string }
        name?: { value?: string }
        backendDOMNodeId?: number
      }>
    }
    const want = name.toLowerCase()
    const nodes = ax.nodes || []
    const nameEq = (n: (typeof nodes)[0]) => (n.name?.value || '').trim() === name
    const nameEqCi = (n: (typeof nodes)[0]) => (n.name?.value || '').trim().toLowerCase() === want
    const nameInc = (n: (typeof nodes)[0]) => {
      const nname = (n.name?.value || '').trim().toLowerCase()
      // 避免「发布」命中侧栏「发布笔记」
      return !!nname && nname === want
    }
    const roleOf = (n: (typeof nodes)[0]) => (n.role?.value || '').toLowerCase()
    const candidates = [
      ...nodes.filter((n) => roleOf(n) === 'button' && nameEq(n)),
      ...nodes.filter((n) => roleOf(n) === 'button' && nameEqCi(n)),
      ...nodes.filter((n) => nameEq(n)),
      ...nodes.filter((n) => nameEqCi(n)),
      ...nodes.filter((n) => nameInc(n)),
    ]
    let best: CdpBox | null = null
    let bestScore = -1
    const seen = new Set<number>()
    for (const hit of candidates) {
      const bid = hit.backendDOMNodeId
      if (!bid || seen.has(bid)) continue
      seen.add(bid)
      const promoted = await promoteToClickable(
        target,
        { backendNodeId: bid },
        'cdp_ax',
        hit.name?.value,
      )
      if (!promoted) continue
      // 过滤零尺寸 / 贴顶 / 远超视口的幽灵节点
      if (promoted.width < 8 || promoted.height < 8) continue
      if (promoted.y < 16 && promoted.height < 20) continue
      if (promoted.y > 900) continue
      const node = (await describeNode(target, { backendNodeId: bid })) || {}
      let score = clickScore(promoted, node) + (roleOf(hit) === 'button' ? 30_000 : 0)
      // 草稿抽屉：右侧 + 主视口内；同名多命中时偏好可见编辑钮（勿点 y>900 幽灵）
      if (promoted.y >= 120 && promoted.y <= 720) score += 25_000
      if (promoted.x >= 1400) score += 20_000
      score += Math.min(promoted.x, 2000) * 0.3 + Math.min(promoted.y, 800) * 2
      if (score > bestScore) {
        bestScore = score
        best = promoted
      }
    }
    return best
  })
}

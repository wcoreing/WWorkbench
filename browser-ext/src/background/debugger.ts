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

/**
 * Closed Shadow / 深层节点：用 CDP DOM.performSearch（含 UA shadow）或 AX 树按名称定位，再取 box 点击。
 */
export async function cdpResolveBox(
  tabId: number,
  args: { selector?: string; name?: string; query?: string; text?: string },
): Promise<{ x: number; y: number; width: number; height: number; via: string; label?: string } | null> {
  return withDebugger(tabId, async (target) => {
    const selector = String(args.selector || '').trim()
    if (selector) {
      try {
        const search = (await chrome.debugger.sendCommand(target, 'DOM.performSearch', {
          query: selector,
          includeUserAgentShadowDOM: true,
        })) as { searchId: string; resultCount: number }
        if (search?.resultCount > 0) {
          const results = (await chrome.debugger.sendCommand(target, 'DOM.getSearchResults', {
            searchId: search.searchId,
            fromIndex: 0,
            toIndex: Math.min(search.resultCount, 5),
          })) as { nodeIds: number[] }
          await chrome.debugger.sendCommand(target, 'DOM.discardSearchResults', { searchId: search.searchId }).catch(() => {})
          for (const nodeId of results?.nodeIds || []) {
            try {
              const box = (await chrome.debugger.sendCommand(target, 'DOM.getBoxModel', { nodeId })) as {
                model?: { content: number[] }
              }
              const c = box?.model?.content
              if (!c || c.length < 8) continue
              const xs = [c[0], c[2], c[4], c[6]]
              const ys = [c[1], c[3], c[5], c[7]]
              const x = (xs[0] + xs[1] + xs[2] + xs[3]) / 4
              const y = (ys[0] + ys[1] + ys[2] + ys[3]) / 4
              return {
                x,
                y,
                width: Math.max(xs) - Math.min(xs),
                height: Math.max(ys) - Math.min(ys),
                via: 'cdp_search',
              }
            } catch {
              /* try next */
            }
          }
        }
      } catch {
        /* fall through to AX */
      }
    }

    const name = String(args.name || args.query || args.text || '').trim()
    if (!name) return null
    const ax = (await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree', {})) as {
      nodes?: Array<{
        role?: { value?: string }
        name?: { value?: string }
        backendDOMNodeId?: number
      }>
    }
    const want = name.toLowerCase()
    const nodes = ax.nodes || []
    // 先精确名，再 includes（避免「发布」命中侧栏「发布笔记」）
    const hit =
      nodes.find((n) => (n.name?.value || '').trim() === name) ||
      nodes.find((n) => (n.name?.value || '').trim().toLowerCase() === want) ||
      nodes.find((n) => {
        const nname = (n.name?.value || '').trim().toLowerCase()
        return !!nname && nname.includes(want)
      })
    if (!hit?.backendDOMNodeId) return null
    const box = (await chrome.debugger.sendCommand(target, 'DOM.getBoxModel', {
      backendNodeId: hit.backendDOMNodeId,
    })) as { model?: { content: number[] } }
    const c = box?.model?.content
    if (!c || c.length < 8) return null
    const xs = [c[0], c[2], c[4], c[6]]
    const ys = [c[1], c[3], c[5], c[7]]
    return {
      x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4,
      y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      via: 'cdp_ax',
      label: hit.name?.value,
    }
  })
}

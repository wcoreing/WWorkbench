/** 终端分屏布局节点 */
export type PaneLayout =
  | { kind: 'leaf'; paneId: string; sessionId: string }
  | {
      kind: 'split'
      paneId: string
      direction: 'row' | 'col'
      ratio: number
      first: PaneLayout
      second: PaneLayout
    }

/** createLeaf 创建叶子分屏节点。 */
export function createLeaf(sessionId: string, paneId?: string): PaneLayout {
  return { kind: 'leaf', paneId: paneId ?? `pane-${sessionId}`, sessionId }
}

/** countLeaves 统计叶子分屏数量。 */
export function countLeaves(layout: PaneLayout): number {
  if (layout.kind === 'leaf') return 1
  return countLeaves(layout.first) + countLeaves(layout.second)
}

/** firstLeafId 返回布局中第一个叶子的 paneId。 */
export function firstLeafId(layout: PaneLayout): string {
  if (layout.kind === 'leaf') return layout.paneId
  return firstLeafId(layout.first)
}

/** collectSessionIds 收集布局中全部会话 ID。 */
export function collectSessionIds(layout: PaneLayout): string[] {
  if (layout.kind === 'leaf') return [layout.sessionId]
  return [...collectSessionIds(layout.first), ...collectSessionIds(layout.second)]
}

/** replaceSessionIds 按深度优先顺序替换各叶子的 sessionId 与 paneId。 */
export function replaceSessionIds(layout: PaneLayout, sessionIds: string[]): PaneLayout {
  let idx = 0
  const walk = (node: PaneLayout): PaneLayout => {
    if (node.kind === 'leaf') {
      const sessionId = sessionIds[idx++]
      if (!sessionId) return node
      return { kind: 'leaf', paneId: `pane-${sessionId}`, sessionId }
    }
    return {
      ...node,
      first: walk(node.first),
      second: walk(node.second),
    }
  }
  return walk(layout)
}

/** findPane 按 paneId 查找节点。 */
export function findPane(layout: PaneLayout, paneId: string): PaneLayout | null {
  if (layout.paneId === paneId) return layout
  if (layout.kind === 'split') {
    return findPane(layout.first, paneId) ?? findPane(layout.second, paneId)
  }
  return null
}

/** splitPane 将目标叶子拆为二分屏。 */
export function splitPane(
  layout: PaneLayout,
  targetPaneId: string,
  direction: 'row' | 'col',
  newSessionId: string
): PaneLayout | null {
  if (layout.kind === 'leaf') {
    if (layout.paneId !== targetPaneId) return null
    const newPaneId = `pane-${newSessionId}`
    return {
      kind: 'split',
      paneId: layout.paneId,
      direction,
      ratio: 0.5,
      first: layout,
      second: createLeaf(newSessionId, newPaneId),
    }
  }
  const first = splitPane(layout.first, targetPaneId, direction, newSessionId)
  if (first) return { ...layout, first }
  const second = splitPane(layout.second, targetPaneId, direction, newSessionId)
  if (second) return { ...layout, second }
  return null
}

/** setSplitRatio 更新分屏比例。 */
export function setSplitRatio(layout: PaneLayout, splitPaneId: string, ratio: number): PaneLayout {
  if (layout.kind === 'leaf') return layout
  if (layout.paneId === splitPaneId) {
    return { ...layout, ratio: Math.min(0.85, Math.max(0.15, ratio)) }
  }
  return {
    ...layout,
    first: setSplitRatio(layout.first, splitPaneId, ratio),
    second: setSplitRatio(layout.second, splitPaneId, ratio),
  }
}

/** closePane 关闭叶子并合并分屏。 */
export function closePane(layout: PaneLayout, targetPaneId: string): PaneLayout | null {
  if (layout.kind === 'leaf') {
    return layout.paneId === targetPaneId ? null : layout
  }
  if (layout.first.kind === 'leaf' && layout.first.paneId === targetPaneId) {
    return layout.second
  }
  if (layout.second.kind === 'leaf' && layout.second.paneId === targetPaneId) {
    return layout.first
  }
  const first = closePane(layout.first, targetPaneId)
  const second = closePane(layout.second, targetPaneId)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}

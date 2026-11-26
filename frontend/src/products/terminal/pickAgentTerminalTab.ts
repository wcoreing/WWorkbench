export type AgentTabConnect = 'connecting' | 'ready' | 'failed'

/** AgentTabCandidate Agent 在同一目标里可见的一张标签。 */
export interface AgentTabCandidate {
  id: string
  connectState: AgentTabConnect
  focusedAt?: number
  /** ready 且画面像停在提示符 */
  idle: boolean
}

/** AgentTabDecision 复用、重连或新开。inject 表示要把命令写进该标签。 */
export type AgentTabDecision =
  | { action: 'reuse'; tabId: string; inject: boolean }
  | { action: 'retry'; tabId: string; inject: boolean }
  | { action: 'spawn' }

/**
 * pickAgentTerminalTab 同一目标（本机 workDir 或远端 host）的选标签。
 * 要注入：最近聚焦且空闲的已连通标签；已连通的都在忙则新开；没有已连通的才重连失败/连接中。
 * 不注入：最近聚焦的已连通标签；没有则重连；再没有则新开。
 */
export function pickAgentTerminalTab(tabs: AgentTabCandidate[], inject: boolean): AgentTabDecision {
  const recent = tabs
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => (b.tab.focusedAt ?? 0) - (a.tab.focusedAt ?? 0) || a.index - b.index)
    .map((item) => item.tab)

  if (inject) {
    const idle = recent.find((tab) => tab.connectState === 'ready' && tab.idle)
    if (idle) return { action: 'reuse', tabId: idle.id, inject: true }
    if (recent.some((tab) => tab.connectState === 'ready')) return { action: 'spawn' }
    const broken = recent.find((tab) => tab.connectState === 'failed' || tab.connectState === 'connecting')
    if (broken) return { action: 'retry', tabId: broken.id, inject: true }
    return { action: 'spawn' }
  }

  const ready = recent.find((tab) => tab.connectState === 'ready')
  if (ready) return { action: 'reuse', tabId: ready.id, inject: false }
  const broken = recent.find((tab) => tab.connectState === 'failed' || tab.connectState === 'connecting')
  if (broken) return { action: 'retry', tabId: broken.id, inject: false }
  return { action: 'spawn' }
}

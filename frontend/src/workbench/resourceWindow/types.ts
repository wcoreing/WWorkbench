/** 资源表面展示形态：面板（舞台分栏）/ 弹窗 / 全屏产品线。 */
export type ResourcePresentation = 'panel' | 'dialog' | 'product'

/** 可开窗的资源种类（与项目 links.kind 对齐）。 */
export type ResourceKind =
  | 'ssh'
  | 'database'
  | 'docker'
  | 'log'
  | 'http'
  | 'note'
  | 'skill'
  | 'backup'
  | 'sftp'

/** openResource 入参。 */
export type OpenResourceInput = {
  kind: ResourceKind
  resourceId: string
  title?: string
  /** 默认 dialog；无 Surface 实现时自动降级 product。 */
  presentation?: ResourcePresentation
  /** 舞台键：项目 id；空则 global。 */
  stageKey?: string
  meta?: Record<string, string>
}

/** 已打开的资源窗实例。 */
export type ResourceWindow = {
  id: string
  kind: ResourceKind
  resourceId: string
  title: string
  presentation: ResourcePresentation
  stageKey: string
  meta?: Record<string, string>
  openedAt: number
}

/** 当前已实现嵌入 Surface 的种类（其余走 product）。 */
export const PANEL_READY_KINDS: readonly ResourceKind[] = [
  'ssh',
  'note',
  'skill',
  'log',
  'database',
  'http',
  'docker',
  'backup',
  'sftp',
]

export function resourceWindowKey(kind: ResourceKind, resourceId: string): string {
  return `${kind}:${resourceId}`
}

export function isPanelReadyKind(kind: ResourceKind): boolean {
  return (PANEL_READY_KINDS as readonly string[]).includes(kind)
}

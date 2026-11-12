/** 系统资源标签：可跨产品复用；有 action 则可点。 */

export type ResourceTagTone = 'neutral' | 'accent' | 'success' | 'warning'

export type ResourceTagAction = {
  kind: string
  payload?: Record<string, unknown>
}

export type ResourceTag = {
  id: string
  label: string
  title?: string
  tone?: ResourceTagTone
  /** 有 action 才可点；无则纯展示 */
  action?: ResourceTagAction
}

export type ResourceTagActivate = (tag: ResourceTag) => void

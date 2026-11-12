/** 通知级别。 */
export type NotifyKind = 'success' | 'error' | 'info' | 'warning'

/** 一条系统通知。 */
export type NotifyItem = {
  id: string
  kind: NotifyKind
  message: string
  /** 可选标题；缺省时仅展示 message。 */
  title?: string
  /** 可复制的短码（如版本 hash）。 */
  detail?: string
  /** 停留毫秒；0 表示不自动关闭。 */
  duration: number
  createdAt: number
}

export type NotifyOptions = {
  title?: string
  detail?: string
  duration?: number
}

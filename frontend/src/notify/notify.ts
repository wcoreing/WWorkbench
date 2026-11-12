import { useNotifyStore } from './notifyStore'
import type { NotifyOptions } from './types'

function push(kind: 'success' | 'error' | 'info' | 'warning', message: string, opts?: NotifyOptions) {
  return useNotifyStore.getState().push(kind, message, opts)
}

/**
 * notify 系统通知 API（不依赖 React 组件树）。
 * 成功/失败结果反馈用此通道；底栏 statusMessage 留给环境态。
 */
export const notify = {
  success: (message: string, opts?: NotifyOptions) => push('success', message, opts),
  error: (message: string, opts?: NotifyOptions) => push('error', message, opts),
  info: (message: string, opts?: NotifyOptions) => push('info', message, opts),
  warning: (message: string, opts?: NotifyOptions) => push('warning', message, opts),
  dismiss: (id: string) => useNotifyStore.getState().dismiss(id),
  clear: () => useNotifyStore.getState().clear(),
}

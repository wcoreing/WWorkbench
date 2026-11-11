import { ensureContent, focusTab, wantActivateWindow } from './tabs'

/** 打开浮层后等待渲染（Element/Ant 面板需 tick）。 */
export function settleMs(args: Record<string, unknown> | undefined, fallback = 280) {
  return Math.min(Math.max(Number(args?.openWaitMs) || fallback, 80), 2000)
}

/** 日期/下拉等控件共用：聚焦标签 + 确保 content 版本。 */
export async function prepareWidgetTab(tid: number, args: Record<string, unknown> = {}) {
  await focusTab(tid, wantActivateWindow(args))
  await ensureContent(tid)
}

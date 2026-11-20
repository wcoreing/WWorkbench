import { WindowSetAlwaysOnTop } from '../../wailsjs/runtime/runtime'

/** applyWindowAlwaysOnTop 窗口置顶（Wails AlwaysOnTop）。 */
export function applyWindowAlwaysOnTop(on: boolean) {
  try {
    WindowSetAlwaysOnTop(!!on)
  } catch {
    /* runtime 未就绪时忽略 */
  }
}

import { OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime'

type Handler = (x: number, y: number, paths: string[]) => boolean

const handlers = new Set<Handler>()
let installed = false

function dispatch(x: number, y: number, paths: string[]) {
  if (!paths?.length) return
  for (const handler of [...handlers].reverse()) {
    try {
      if (handler(x, y, paths)) return
    } catch {
      /* 下一个落点 */
    }
  }
}

/** bindOsFileDrop 注册访达拖入。Wails 只保留一个 OnFileDrop，这里按落点分发。 */
export function bindOsFileDrop(handler: Handler): () => void {
  handlers.add(handler)
  if (!installed) {
    installed = true
    OnFileDrop((x, y, paths) => dispatch(x, y, paths), true)
  }
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0 && installed) {
      OnFileDropOff()
      installed = false
    }
  }
}

/** hitOsDropTarget 落点是否在带 Wails drop 标记的区域内。 */
export function hitOsDropTarget(x: number, y: number, selector: string): boolean {
  const el = document.elementFromPoint(x, y)
  return Boolean(el?.closest(selector))
}

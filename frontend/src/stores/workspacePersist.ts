import { api } from '../api/client'

/** createDebouncedWorkspaceSaver 防抖保存工作区 JSON 到 dataDir。 */
export function createDebouncedWorkspaceSaver(product: string, delay = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (snapshot: unknown) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void api.saveWorkspace(product, JSON.stringify(snapshot)).catch(() => {})
      timer = null
    }, delay)
  }
}

/** loadWorkspaceSnapshot 从后端读取工作区 JSON。 */
export async function loadWorkspaceSnapshot<T>(product: string): Promise<T | null> {
  try {
    const raw = await api.loadWorkspace(product)
    if (!raw?.trim()) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

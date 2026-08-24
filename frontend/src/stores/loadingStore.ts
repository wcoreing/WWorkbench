import { create } from 'zustand'

type LoadingTask = {
  count: number
  label?: string
}

interface LoadingState {
  tasks: Record<string, LoadingTask>
  begin: (key: string, label?: string) => void
  end: (key: string) => void
}

export const useLoadingStore = create<LoadingState>((set) => ({
  tasks: {},
  begin: (key, label) =>
    set((state) => {
      const prev = state.tasks[key]
      const count = (prev?.count ?? 0) + 1
      return {
        tasks: {
          ...state.tasks,
          [key]: { count, label: label ?? prev?.label },
        },
      }
    }),
  end: (key) =>
    set((state) => {
      const prev = state.tasks[key]
      if (!prev) return state
      const count = prev.count - 1
      if (count <= 0) {
        const next = { ...state.tasks }
        delete next[key]
        return { tasks: next }
      }
      return { tasks: { ...state.tasks, [key]: { ...prev, count } } }
    }),
}))

export type WithLoadingOptions = {
  label?: string
  /** 不展示 loading（后台刷新） */
  silent?: boolean
  /** 请求开始前回调，用于清空将被刷新的内容 */
  onBegin?: () => void
}

/** withLoading 统一包裹异步更新；调用侧只负责 key + fn，展示由 LoadingPane 承担。 */
export async function withLoading<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: WithLoadingOptions,
): Promise<T> {
  if (opts?.silent) return fn()

  const { begin, end } = useLoadingStore.getState()
  opts?.onBegin?.()
  begin(key, opts?.label)
  try {
    return await fn()
  } finally {
    end(key)
  }
}

/** useLoading 订阅单个 loading key。 */
export function useLoading(key: string) {
  const task = useLoadingStore((s) => s.tasks[key])
  return {
    active: (task?.count ?? 0) > 0,
    label: task?.label,
  }
}

/** useLoadingScope 订阅某前缀下任意 in-flight 任务。 */
export function useLoadingScope(prefix: string) {
  const tasks = useLoadingStore((s) => s.tasks)
  const matched = Object.entries(tasks).filter(([k]) => k === prefix || k.startsWith(`${prefix}.`))
  const active = matched.some(([, t]) => t.count > 0)
  const label = matched.find(([, t]) => t.count > 0)?.[1]?.label
  return { active, label }
}

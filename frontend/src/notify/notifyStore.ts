import { create } from 'zustand'
import type { NotifyItem, NotifyKind, NotifyOptions } from './types'

const MAX_VISIBLE = 3

const DEFAULT_DURATION: Record<NotifyKind, number> = {
  success: 2800,
  info: 2800,
  warning: 4200,
  error: 5600,
}

type NotifyState = {
  items: NotifyItem[]
  push: (kind: NotifyKind, message: string, opts?: NotifyOptions) => string
  dismiss: (id: string) => void
  clear: () => void
}

let seq = 0

function nextId(): string {
  seq += 1
  return `ntf-${Date.now().toString(36)}-${seq}`
}

/** useNotifyStore 系统通知队列（Toast）。 */
export const useNotifyStore = create<NotifyState>((set, get) => ({
  items: [],
  push: (kind, message, opts) => {
    const text = (message || '').trim()
    if (!text) return ''
    const id = nextId()
    const item: NotifyItem = {
      id,
      kind,
      message: text,
      title: opts?.title?.trim() || undefined,
      detail: opts?.detail?.trim() || undefined,
      duration: opts?.duration ?? DEFAULT_DURATION[kind],
      createdAt: Date.now(),
    }
    set((s) => {
      const next = [...s.items, item]
      return { items: next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next }
    })
    if (item.duration > 0) {
      window.setTimeout(() => {
        get().dismiss(id)
      }, item.duration)
    }
    return id
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
  clear: () => set({ items: [] }),
}))

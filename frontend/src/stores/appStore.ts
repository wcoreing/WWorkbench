import { create } from 'zustand'
import type { Connection, ObjectTreeNode, SessionInfo } from '../api/types'
import type { ProductId } from '../shell/products'

export type WorkTab =
  | { id: string; kind: 'sql'; title: string; sql: string }
  | { id: string; kind: 'table'; title: string; database: string; table: string }
  | { id: string; kind: 'ddl'; title: string; content: string }

interface AppState {
  version: string
  theme: 'light' | 'dark'
  activeProduct: ProductId
  connections: Connection[]
  activeConnectionId: string | null
  session: SessionInfo | null
  objectTree: ObjectTreeNode[]
  tabs: WorkTab[]
  activeTabId: string | null
  statusMessage: string
  terminalOpacity: number
  setVersion: (v: string) => void
  setTheme: (t: 'light' | 'dark') => void
  setActiveProduct: (id: ProductId) => void
  setConnections: (c: Connection[]) => void
  setActiveConnectionId: (id: string | null) => void
  setSession: (s: SessionInfo | null) => void
  setObjectTree: (t: ObjectTreeNode[]) => void
  setTabs: (tabs: WorkTab[]) => void
  setActiveTabId: (id: string | null) => void
  setStatusMessage: (msg: string) => void
  setTerminalOpacity: (v: number) => void
  addTab: (tab: WorkTab) => void
  updateSqlTab: (id: string, sql: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  version: '0.0.0',
  theme: (localStorage.getItem('wn-theme') as 'light' | 'dark') || 'light',
  activeProduct: (localStorage.getItem('wn-product') as ProductId) || 'database',
  connections: [],
  activeConnectionId: null,
  session: null,
  objectTree: [],
  tabs: [{ id: 'sql-1', kind: 'sql', title: '无标题 - 查询', sql: '-- 输入 SQL\n' }],
  activeTabId: 'sql-1',
  statusMessage: '就绪',
  terminalOpacity: Number(localStorage.getItem('wn-terminal-opacity') || '0.92'),
  setVersion: (version) => set({ version }),
  setTheme: (theme) => {
    localStorage.setItem('wn-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
  setActiveProduct: (activeProduct) => {
    localStorage.setItem('wn-product', activeProduct)
    set({ activeProduct })
  },
  setConnections: (connections) => set({ connections }),
  setActiveConnectionId: (activeConnectionId) => set({ activeConnectionId }),
  setSession: (session) => set({ session }),
  setObjectTree: (objectTree) => set({ objectTree }),
  setTabs: (tabs) => set({ tabs }),
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setTerminalOpacity: (terminalOpacity) => {
    const v = Math.min(1, Math.max(0.4, terminalOpacity))
    localStorage.setItem('wn-terminal-opacity', String(v))
    set({ terminalOpacity: v })
  },
  addTab: (tab) => {
    const tabs = [...get().tabs, tab]
    set({ tabs, activeTabId: tab.id })
  },
  updateSqlTab: (id, sql) => {
    set({
      tabs: get().tabs.map((t) => (t.id === id && t.kind === 'sql' ? { ...t, sql } : t)),
    })
  },
}))

import { create } from 'zustand'
import type { Connection, ObjectTreeNode, SessionInfo } from '../api/types'
import type { ProductId } from '../shell/products'
import type { TableDesignDraft } from '../features/table-design/tableDesignDraft'
import {
  defaultDatabaseWorkspace,
  subscribeDatabaseWorkspacePersist,
} from './databaseWorkspacePersist'
import type { WorkTab } from './workTab'
import { APP_SETTING_KEYS, saveAppSetting } from './appPreferences'

export type { WorkTab } from './workTab'

export type ProductLinkAction = 'terminal' | 'sftp' | 'database' | 'docker-context'

export interface ConnectionDraft {
  name?: string
  group?: string
  dbType?: string
  host?: string
  port?: number
  user?: string
  database?: string
  charset?: string
  sshEnabled?: boolean
  sshHostId?: string
}

export interface ProductLinkRequest {
  action: ProductLinkAction
  hostId?: string
  localShell?: boolean
  initialCommand?: string
  connectionDraft?: ConnectionDraft
}

interface AppState {
  version: string
  preferencesReady: boolean
  theme: 'light' | 'dark'
  activeProduct: ProductId
  connections: Connection[]
  activeConnectionId: string | null
  session: SessionInfo | null
  objectTree: ObjectTreeNode[]
  tabs: WorkTab[]
  activeTabId: string | null
  designDrafts: Record<string, TableDesignDraft>
  productLink: ProductLinkRequest | null
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
  replaceTab: (oldId: string, tab: WorkTab) => void
  updateSqlTab: (id: string, sql: string) => void
  updateDdlTab: (id: string, content: string) => void
  setDesignDraft: (tabId: string, draft: TableDesignDraft) => void
  clearDesignDraft: (tabId: string) => void
  setProductLink: (req: ProductLinkRequest | null) => void
}

const defaults = defaultDatabaseWorkspace()

export const useAppStore = create<AppState>((set, get) => ({
  version: '0.0.0',
  preferencesReady: false,
  theme: 'light',
  activeProduct: 'database',
  connections: [],
  activeConnectionId: null,
  session: null,
  objectTree: [],
  tabs: defaults.tabs,
  activeTabId: defaults.activeTabId,
  designDrafts: defaults.designDrafts,
  productLink: null,
  statusMessage: '就绪',
  terminalOpacity: 0.92,
  setVersion: (version) => set({ version }),
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
    void saveAppSetting(APP_SETTING_KEYS.theme, theme)
  },
  setActiveProduct: (activeProduct) => {
    set({ activeProduct })
    void saveAppSetting(APP_SETTING_KEYS.activeProduct, activeProduct)
  },
  setConnections: (connections) => set({ connections }),
  setActiveConnectionId: (activeConnectionId) => set({ activeConnectionId }),
  setSession: (session) => set({ session }),
  setObjectTree: (objectTree) => set({ objectTree }),
  setTabs: (tabs) => {
    const next = tabs.length ? tabs : defaultDatabaseWorkspace().tabs
    const activeTabId = get().activeTabId
    const validActive = activeTabId && next.some((t) => t.id === activeTabId) ? activeTabId : next[0].id
    set({ tabs: next, activeTabId: validActive })
  },
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setTerminalOpacity: (terminalOpacity) => {
    const v = Math.min(1, Math.max(0.4, terminalOpacity))
    set({ terminalOpacity: v })
    void saveAppSetting(APP_SETTING_KEYS.terminalOpacity, String(v))
  },
  addTab: (tab) => {
    const tabs = [...get().tabs, tab]
    set({ tabs, activeTabId: tab.id })
  },
  replaceTab: (oldId, tab) => {
    const drafts = { ...get().designDrafts }
    delete drafts[oldId]
    set({
      tabs: get().tabs.map((t) => (t.id === oldId ? tab : t)),
      activeTabId: tab.id,
      designDrafts: drafts,
    })
  },
  updateSqlTab: (id, sql) => {
    set({
      tabs: get().tabs.map((t) => (t.id === id && t.kind === 'sql' ? { ...t, sql } : t)),
    })
  },
  updateDdlTab: (id, content) => {
    set({
      tabs: get().tabs.map((t) => (t.id === id && t.kind === 'ddl' ? { ...t, content } : t)),
    })
  },
  setDesignDraft: (tabId, draft) => {
    set({ designDrafts: { ...get().designDrafts, [tabId]: draft } })
  },
  clearDesignDraft: (tabId) => {
    const drafts = { ...get().designDrafts }
    delete drafts[tabId]
    set({ designDrafts: drafts })
  },
  setProductLink: (productLink) => set({ productLink }),
}))

const schedulePersist = subscribeDatabaseWorkspacePersist(() => {
  const { tabs, activeTabId, designDrafts } = useAppStore.getState()
  return { tabs, activeTabId, designDrafts }
})

useAppStore.subscribe((state, prev) => {
  if (state.tabs === prev.tabs && state.activeTabId === prev.activeTabId && state.designDrafts === prev.designDrafts) {
    return
  }
  schedulePersist()
})

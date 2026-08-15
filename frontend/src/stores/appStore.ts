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
import type { AppLocale } from '../i18n/types'
import { applyDocumentLocale, READY_MESSAGES, translate } from '../i18n'
import { applyUiFontSize, DEFAULT_UI_FONT_SIZE, type UiFontSize } from '../shell/uiFontSize'
import { emptyAgentSurface, type AgentSurface } from './agentSurface'
import { dismissOverlays } from '../components/compat/dismissOverlays'

export type { WorkTab } from './workTab'
export type { AgentSurface } from './agentSurface'

export type ProductLinkAction = 'terminal' | 'sftp' | 'database' | 'docker-context' | 'notebook'

export interface ConnectionDraft {
  name?: string
  group?: string
  dbType?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  charset?: string
  sshEnabled?: boolean
  sshHostId?: string
}

export interface ProductLinkRequest {
  action: ProductLinkAction
  hostId?: string
  connectionId?: string
  localShell?: boolean
  initialCommand?: string
  initialSql?: string
  runSql?: boolean
  connectionDraft?: ConnectionDraft
}

interface AppState {
  version: string
  preferencesReady: boolean
  theme: 'light' | 'dark'
  locale: AppLocale
  activeProduct: ProductId
  connections: Connection[]
  activeConnectionId: string | null
  session: SessionInfo | null
  objectTree: ObjectTreeNode[]
  tabs: WorkTab[]
  activeTabId: string | null
  designDrafts: Record<string, TableDesignDraft>
  statusMessage: string
  terminalOpacity: number
  uiFontSize: UiFontSize
  agentSurface: AgentSurface
  notebookFocusNoteId: string | null
  notebookActiveNoteId: string | null
  setVersion: (v: string) => void
  setTheme: (t: 'light' | 'dark') => void
  setLocale: (locale: AppLocale) => void
  setActiveProduct: (id: ProductId) => void
  setConnections: (c: Connection[]) => void
  setActiveConnectionId: (id: string | null) => void
  setSession: (s: SessionInfo | null) => void
  setObjectTree: (t: ObjectTreeNode[]) => void
  setTabs: (tabs: WorkTab[]) => void
  setActiveTabId: (id: string | null) => void
  setStatusMessage: (msg: string) => void
  setTerminalOpacity: (v: number) => void
  setUiFontSize: (px: number) => void
  setAgentSurface: (surface: AgentSurface) => void
  setNotebookFocusNoteId: (id: string | null) => void
  setNotebookActiveNoteId: (id: string | null) => void
  addTab: (tab: WorkTab) => void
  replaceTab: (oldId: string, tab: WorkTab) => void
  updateSqlTab: (id: string, sql: string) => void
  updateDdlTab: (id: string, content: string) => void
  setDesignDraft: (tabId: string, draft: TableDesignDraft) => void
  clearDesignDraft: (tabId: string) => void
}

const defaults = defaultDatabaseWorkspace()

export const useAppStore = create<AppState>((set, get) => ({
  version: '0.0.0',
  preferencesReady: false,
  theme: 'light',
  locale: 'zh',
  activeProduct: 'database',
  connections: [],
  activeConnectionId: null,
  session: null,
  objectTree: [],
  tabs: defaults.tabs,
  activeTabId: defaults.activeTabId,
  designDrafts: defaults.designDrafts,
  statusMessage: '就绪',
  terminalOpacity: 0.92,
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  agentSurface: emptyAgentSurface(),
  notebookFocusNoteId: null,
  notebookActiveNoteId: null,
  setVersion: (version) => set({ version }),
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
    void saveAppSetting(APP_SETTING_KEYS.theme, theme)
  },
  setLocale: (locale) => {
    applyDocumentLocale(locale)
    set((state) => {
      const patch: Partial<AppState> = { locale }
      if (READY_MESSAGES.has(state.statusMessage)) {
        patch.statusMessage = translate(locale, 'common.ready')
      }
      return patch
    })
    void saveAppSetting(APP_SETTING_KEYS.locale, locale)
  },
  setActiveProduct: (activeProduct) => {
    const prev = get().activeProduct
    set({ activeProduct })
    if (prev !== activeProduct) {
      dismissOverlays()
      // 隐藏产品线内的焦点（xterm/input）会抢下一次点击
      requestAnimationFrame(() => {
        const ae = document.activeElement as HTMLElement | null
        if (ae?.closest?.('.product-view-host[hidden]')) {
          ae.blur()
        }
      })
    }
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
    const v = Math.min(1, Math.max(0.15, terminalOpacity))
    set({ terminalOpacity: v })
    void saveAppSetting(APP_SETTING_KEYS.terminalOpacity, String(v))
  },
  setUiFontSize: (px) => {
    const uiFontSize = applyUiFontSize(px)
    set({ uiFontSize })
    void saveAppSetting(APP_SETTING_KEYS.uiFontSize, String(uiFontSize))
  },
  setAgentSurface: (agentSurface) => set({ agentSurface }),
  setNotebookFocusNoteId: (notebookFocusNoteId) => set({ notebookFocusNoteId }),
  setNotebookActiveNoteId: (notebookActiveNoteId) => set({ notebookActiveNoteId }),
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

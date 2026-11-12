/**
 * Pack 侧 @wworkbench/host 类型桩（分层）。
 * 运行时由 Host installWWHost() → globalThis.WWHost。
 */
declare module '@wworkbench/host' {
  import type { ComponentType } from 'react'

  export const api: any

  export const i18n: {
    useI18n: () => { t: (key: string, vars?: Record<string, string | number>) => string }
    defaultUntitledSql: () => string
    localizeWorkTabTitle: (...args: any[]) => string
  }

  export const store: {
    useAppStore: <T = any>(selector?: (s: any) => T) => T
    useLoading: (...args: any[]) => boolean
    withLoading: <T>(...args: any[]) => Promise<T>
    APP_SETTING_KEYS: Record<string, string>
    saveAppSetting: (...args: any[]) => void
    buildDatabaseSurface: (...args: any[]) => any
  }

  export const nav: {
    openTerminal: (...args: any[]) => void
    openSftp: (...args: any[]) => void
    openNotebook: (...args: any[]) => void
    openBackup: (...args: any[]) => void
    useWorkbenchCommand: (...args: any[]) => void
    openAgentDraft: (...args: any[]) => void
    mentionDatabase: (...args: any[]) => any
    assetDragRowProps?: (...args: any[]) => Record<string, unknown>
    beginAssetDrag?: (...args: any[]) => void
    bindAssetsToAgent?: (...args: any[]) => any
  }

  export const workbench: {
    Capability: Record<string, string>
    payloadBool: (...args: any[]) => boolean
    payloadStr: (...args: any[]) => string
    subscribeWorkbenchChanged: (fn: (ev: WorkbenchChangedEvent) => void) => () => void
    takePendingWorkbenchChanged: (...args: any[]) => WorkbenchChangedEvent | undefined
  }

  export const ui: {
    Select: ComponentType<any>
    ConfirmDialog: ComponentType<any>
    ContextMenu: ComponentType<any>
    EmptyState: ComponentType<any>
    ProductLayout: ComponentType<any>
    ResizeHandle: ComponentType<any>
    TabContextMenu: ComponentType<any>
    openTabContextMenu: (...args: any[]) => void
    LoadingPane: ComponentType<any>
    pressProps: (...args: any[]) => Record<string, unknown>
    useDismissOverlays: (fn: () => void) => void
    useResizable: (...args: any[]) => { size: number; onResizeStart: (...a: any[]) => void }
    useScrollActiveTabIntoView: (...args: any[]) => void
    icons: Record<string, ComponentType<any>>
  }

  export const features: {
    ConnectionModal: ComponentType<any>
    DdlEditor: ComponentType<any>
    ObjectTree: ComponentType<any>
    CreateDatabaseDialog: ComponentType<any>
    ResultPanel: ComponentType<any>
    SqlEditor: ComponentType<any>
    TableDesignEditor: ComponentType<any>
    TableDataEditor: ComponentType<any>
    useSQLExport: (...args: any[]) => any
  }

  export const util: {
    queryPageToExport: (...args: any[]) => any
  }

  export type Connection = any
  export type ExecuteResult = any
  export type IndexMeta = any
  export type QueryPage = any
  export type SQLBatchResult = any
  export type SessionInfo = any
  export type ConnectionDraft = any
  export type TabContextMenuState = { x: number; y: number; tabId: string }
  export type SqlEditorHandle = any
  export type WorkbenchChangedEvent = {
    domain?: string
    product?: string
    op?: string
    [key: string]: unknown
  }
}

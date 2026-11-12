/**
 * WWHost — Pack UI 运行时契约（分层表面）。
 *
 * Pack：`import { api, store, ui, features, workbench, nav, i18n, util } from '@wworkbench/host'`
 * Vite external → globalThis.WWHost；禁止打进第二份 React / Host 组件副本。
 */
import { api } from '../api/client'
import type {
  Connection,
  ExecuteResult,
  IndexMeta,
  QueryPage,
  SQLBatchResult,
  SessionInfo,
} from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContextMenu } from '../components/ContextMenu'
import { EmptyState } from '../components/EmptyState'
import { ProductLayout, ResizeHandle, useResizable } from '../components/layout'
import { TabContextMenu, openTabContextMenu } from '../components/TabContextMenu'
import type { TabContextMenuState } from '../components/TabContextMenu'
import {
  IconDisconnect,
  IconDownload,
  IconEdit,
  IconExplain,
  IconFolder,
  IconImportSql,
  IconNotebook,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSql,
  IconTerminal,
  IconTrash,
} from '../components/Icons'
import { Select, pressProps, useDismissOverlays } from '../components/compat'
import { LoadingPane } from '../components/LoadingHost'
import { useLoading, withLoading } from '../stores/loadingStore'
import { ConnectionModal } from '../features/connection/ConnectionModal'
import { DdlEditor } from '../features/ddl/DdlEditor'
import { ObjectTree } from '../features/explorer/ObjectTree'
import { CreateDatabaseDialog } from '../features/database/CreateDatabaseDialog'
import { ResultPanel } from '../features/sql-editor/ResultPanel'
import { SqlEditor } from '../features/sql-editor/SqlEditor'
import type { SqlEditorHandle } from '../features/sql-editor/SqlEditor'
import { TableDesignEditor } from '../features/table-design/TableDesignEditor'
import { TableDataEditor } from '../features/table-data/TableDataEditor'
import { useAppStore } from '../stores/appStore'
import type { ConnectionDraft } from '../stores/appStore'
import { buildDatabaseSurface } from '../stores/agentSurface'
import { openTerminal, openSftp, openNotebook, openBackup, useWorkbenchCommand } from '../stores/productLink'
import { Capability } from '../workbench/capabilities'
import { payloadBool, payloadStr } from '../workbench/commandPayload'
import {
  subscribeWorkbenchChanged,
  takePendingWorkbenchChanged,
} from '../workbench/workbenchRadar'
import type { WorkbenchChangedEvent } from '../workbench/workbenchRadar'
import { APP_SETTING_KEYS, saveAppSetting } from '../stores/appPreferences'
import { openAgentDraft, mentionDatabase } from '../features/agent/openAgentDraft'
import {
  ASSET_DRAG_MIME,
  assetDragHandlers,
  assetDragRowProps,
  beginAssetDrag,
  bindAssetsToAgent,
  readAssetDrag,
  transferHasAssetDrag,
} from '../features/agent/agentAssetDrag'
import { useI18n } from '../i18n'
import { defaultUntitledSql, localizeWorkTabTitle } from '../i18n/databaseTabTitle'
import { queryPageToExport } from '../utils/queryCsv'
import { useScrollActiveTabIntoView } from '../hooks/useScrollActiveTabIntoView'
import { useSQLExport } from '../features/export/useSQLExport'

/** i18n 层 */
export type WWHostI18n = {
  useI18n: typeof useI18n
  defaultUntitledSql: typeof defaultUntitledSql
  localizeWorkTabTitle: typeof localizeWorkTabTitle
}

/** store / 偏好层 */
export type WWHostStore = {
  useAppStore: typeof useAppStore
  useLoading: typeof useLoading
  withLoading: typeof withLoading
  APP_SETTING_KEYS: typeof APP_SETTING_KEYS
  saveAppSetting: typeof saveAppSetting
  buildDatabaseSurface: typeof buildDatabaseSurface
}

/** 跨产品导航 / Agent 草稿 / 统一资产拖拽 */
export type WWHostNav = {
  openTerminal: typeof openTerminal
  openSftp: typeof openSftp
  openNotebook: typeof openNotebook
  openBackup: typeof openBackup
  useWorkbenchCommand: typeof useWorkbenchCommand
  openAgentDraft: typeof openAgentDraft
  mentionDatabase: typeof mentionDatabase
  ASSET_DRAG_MIME: typeof ASSET_DRAG_MIME
  beginAssetDrag: typeof beginAssetDrag
  assetDragHandlers: typeof assetDragHandlers
  assetDragRowProps: typeof assetDragRowProps
  bindAssetsToAgent: typeof bindAssetsToAgent
  readAssetDrag: typeof readAssetDrag
  transferHasAssetDrag: typeof transferHasAssetDrag
}

/** 工作台能力与雷达 */
export type WWHostWorkbench = {
  Capability: typeof Capability
  payloadBool: typeof payloadBool
  payloadStr: typeof payloadStr
  subscribeWorkbenchChanged: typeof subscribeWorkbenchChanged
  takePendingWorkbenchChanged: typeof takePendingWorkbenchChanged
}

/** 壳层 UI（compat / layout / icons） */
export type WWHostUI = {
  Select: typeof Select
  ConfirmDialog: typeof ConfirmDialog
  ContextMenu: typeof ContextMenu
  EmptyState: typeof EmptyState
  ProductLayout: typeof ProductLayout
  ResizeHandle: typeof ResizeHandle
  TabContextMenu: typeof TabContextMenu
  openTabContextMenu: typeof openTabContextMenu
  LoadingPane: typeof LoadingPane
  pressProps: typeof pressProps
  useDismissOverlays: typeof useDismissOverlays
  useResizable: typeof useResizable
  useScrollActiveTabIntoView: typeof useScrollActiveTabIntoView
  icons: {
    IconDisconnect: typeof IconDisconnect
    IconDownload: typeof IconDownload
    IconEdit: typeof IconEdit
    IconExplain: typeof IconExplain
    IconFolder: typeof IconFolder
    IconImportSql: typeof IconImportSql
    IconNotebook: typeof IconNotebook
    IconPlay: typeof IconPlay
    IconPlus: typeof IconPlus
    IconRefresh: typeof IconRefresh
    IconSql: typeof IconSql
    IconTerminal: typeof IconTerminal
    IconTrash: typeof IconTrash
  }
}

/** 数据库业务组件（仍由 Host 提供实现，pack 只组合） */
export type WWHostFeatures = {
  ConnectionModal: typeof ConnectionModal
  DdlEditor: typeof DdlEditor
  ObjectTree: typeof ObjectTree
  CreateDatabaseDialog: typeof CreateDatabaseDialog
  ResultPanel: typeof ResultPanel
  SqlEditor: typeof SqlEditor
  TableDesignEditor: typeof TableDesignEditor
  TableDataEditor: typeof TableDataEditor
  useSQLExport: typeof useSQLExport
}

export type WWHostUtil = {
  queryPageToExport: typeof queryPageToExport
}

/** WWHostAPI 分层表面（与 seed @wworkbench/host 对齐）。 */
export type WWHostAPI = {
  api: typeof api
  i18n: WWHostI18n
  store: WWHostStore
  nav: WWHostNav
  workbench: WWHostWorkbench
  ui: WWHostUI
  features: WWHostFeatures
  util: WWHostUtil
}

/** installWWHost 在 React 挂载前注入，供 pack IIFE external。 */
export function installWWHost() {
  const host: WWHostAPI = {
    api,
    i18n: {
      useI18n,
      defaultUntitledSql,
      localizeWorkTabTitle,
    },
    store: {
      useAppStore,
      useLoading,
      withLoading,
      APP_SETTING_KEYS,
      saveAppSetting,
      buildDatabaseSurface,
    },
    nav: {
      openTerminal,
      openSftp,
      openNotebook,
      openBackup,
      useWorkbenchCommand,
      openAgentDraft,
      mentionDatabase,
      ASSET_DRAG_MIME,
      beginAssetDrag,
      assetDragHandlers,
      assetDragRowProps,
      bindAssetsToAgent,
      readAssetDrag,
      transferHasAssetDrag,
    },
    workbench: {
      Capability,
      payloadBool,
      payloadStr,
      subscribeWorkbenchChanged,
      takePendingWorkbenchChanged,
    },
    ui: {
      Select,
      ConfirmDialog,
      ContextMenu,
      EmptyState,
      ProductLayout,
      ResizeHandle,
      TabContextMenu,
      openTabContextMenu,
      LoadingPane,
      pressProps,
      useDismissOverlays,
      useResizable,
      useScrollActiveTabIntoView,
      icons: {
        IconDisconnect,
        IconDownload,
        IconEdit,
        IconExplain,
        IconFolder,
        IconImportSql,
        IconNotebook,
        IconPlay,
        IconPlus,
        IconRefresh,
        IconSql,
        IconTerminal,
        IconTrash,
      },
    },
    features: {
      ConnectionModal,
      DdlEditor,
      ObjectTree,
      CreateDatabaseDialog,
      ResultPanel,
      SqlEditor,
      TableDesignEditor,
      TableDataEditor,
      useSQLExport,
    },
    util: {
      queryPageToExport,
    },
  }
  Object.assign(globalThis, { WWHost: host })
}

export type {
  Connection,
  ExecuteResult,
  IndexMeta,
  QueryPage,
  SQLBatchResult,
  SessionInfo,
  ConnectionDraft,
  TabContextMenuState,
  SqlEditorHandle,
  WorkbenchChangedEvent,
}

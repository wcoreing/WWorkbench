import type { MouseEvent as ReactMouseEvent } from 'react'
import { useI18n } from '../i18n'

export type TabContextMenuState = { x: number; y: number; tabId: string }

interface Props {
  menu: TabContextMenuState
  /** 仅一个 Tab 时禁用「关闭其他」。 */
  disableCloseOthers?: boolean
  /** 提供时显示「重新连接」。 */
  onReconnect?: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onDismiss: () => void
}

/** TabContextMenu 标签页右键：关闭 / 关闭其他 / 关闭全部。 */
export function TabContextMenu({
  menu,
  disableCloseOthers,
  onReconnect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onDismiss,
}: Props) {
  const { t } = useI18n()
  return (
    <div
      className="wn-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onReconnect && (
        <button
          type="button"
          className="wn-context-item"
          onClick={() => {
            onDismiss()
            onReconnect()
          }}
        >
          {t('terminal.reconnect')}
        </button>
      )}
      <button
        type="button"
        className="wn-context-item"
        onClick={() => {
          onDismiss()
          onClose()
        }}
      >
        {t('common.close')}
      </button>
      <button
        type="button"
        className="wn-context-item"
        disabled={disableCloseOthers}
        onClick={() => {
          if (disableCloseOthers) return
          onDismiss()
          onCloseOthers()
        }}
      >
        {t('common.closeOthers')}
      </button>
      <button
        type="button"
        className="wn-context-item"
        onClick={() => {
          onDismiss()
          onCloseAll()
        }}
      >
        {t('common.closeAll')}
      </button>
    </div>
  )
}

/** openTabContextMenu 打开标签右键菜单（阻止默认菜单并选中该 Tab）。 */
export function openTabContextMenu(
  e: ReactMouseEvent,
  tabId: string,
  setMenu: (m: TabContextMenuState) => void,
  setActiveTabId?: (id: string) => void
) {
  e.preventDefault()
  e.stopPropagation()
  setActiveTabId?.(tabId)
  setMenu({ x: e.clientX, y: e.clientY, tabId })
}

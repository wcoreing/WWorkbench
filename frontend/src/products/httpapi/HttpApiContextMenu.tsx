import type { HTTPFolder, HTTPSavedRequest } from '../../api/types'
import { useI18n } from '../../i18n'

export interface HttpApiContextMenuState {
  x: number
  y: number
  item: HTTPSavedRequest
}

interface Props {
  menu: HttpApiContextMenuState
  folders: HTTPFolder[]
  onClose: () => void
  onMoveToFolder: (apiId: string, folderId: string) => void
  onSendToAgent: (item: HTTPSavedRequest) => void
  onDuplicate: (item: HTTPSavedRequest) => void
  onDelete: (item: HTTPSavedRequest) => void
}

/** HttpApiContextMenu 接口树右键菜单。 */
export function HttpApiContextMenu({
  menu,
  folders,
  onClose,
  onMoveToFolder,
  onSendToAgent,
  onDuplicate,
  onDelete,
}: Props) {
  const { t } = useI18n()
  const { item } = menu

  const act = (fn: () => void) => {
    onClose()
    fn()
  }

  return (
    <div
      className="wn-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="wn-context-submenu-label">{t('httpapi.moveToFolder')}</div>
      <button
        type="button"
        className="wn-context-item wn-context-item-indent"
        disabled={!item.folderId}
        onClick={() => act(() => onMoveToFolder(item.id, ''))}
      >
        {t('httpapi.moveToRoot')}
      </button>
      {folders.map((f) => (
        <button
          key={f.id}
          type="button"
          className="wn-context-item wn-context-item-indent"
          disabled={f.id === item.folderId}
          onClick={() => act(() => onMoveToFolder(item.id, f.id))}
        >
          {f.name}
        </button>
      ))}
      <button type="button" className="wn-context-item" onClick={() => act(() => onSendToAgent(item))}>
        {t('agent.sendToAgent')}
      </button>
      <button type="button" className="wn-context-item" onClick={() => act(() => onDuplicate(item))}>
        {t('httpapi.duplicate')}
      </button>
      <button
        type="button"
        className="wn-context-item wn-context-item-danger"
        onClick={() => act(() => onDelete(item))}
      >
        {t('common.delete')}
      </button>
    </div>
  )
}

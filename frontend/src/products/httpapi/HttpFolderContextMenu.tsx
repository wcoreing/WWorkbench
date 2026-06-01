import type { HTTPFolder } from '../../api/types'
import { useI18n } from '../../i18n'

export interface HttpFolderContextMenuState {
  x: number
  y: number
  folder: HTTPFolder
}

interface Props {
  menu: HttpFolderContextMenuState
  onClose: () => void
  onNewSubfolder: (folder: HTTPFolder) => void
  onRename: (folder: HTTPFolder) => void
  onNewApi: (folderId: string) => void
  onDelete: (folder: HTTPFolder) => void
}

/** HttpFolderContextMenu 目录树右键菜单。 */
export function HttpFolderContextMenu({
  menu,
  onClose,
  onNewSubfolder,
  onRename,
  onNewApi,
  onDelete,
}: Props) {
  const { t } = useI18n()
  const { folder } = menu

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
      <button type="button" className="wn-context-item" onClick={() => act(() => onNewSubfolder(folder))}>
        {t('httpapi.newSubfolder')}
      </button>
      <button type="button" className="wn-context-item" onClick={() => act(() => onRename(folder))}>
        {t('httpapi.renameFolder')}
      </button>
      <button type="button" className="wn-context-item" onClick={() => act(() => onNewApi(folder.id))}>
        {t('httpapi.newRequestInFolder')}
      </button>
      <button
        type="button"
        className="wn-context-item wn-context-item-danger"
        onClick={() => act(() => onDelete(folder))}
      >
        {t('httpapi.deleteFolder')}
      </button>
    </div>
  )
}

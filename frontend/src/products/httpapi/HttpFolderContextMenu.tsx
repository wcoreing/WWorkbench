import type { HTTPFolder } from '../../api/types'
import { ContextMenu } from '../../components/ContextMenu'
import { useI18n } from '../../i18n'
import { pressProps } from '../../components/compat'

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
    <ContextMenu
      key={`http-folder-${folder.id}-${menu.x}-${menu.y}`}
      x={menu.x}
      y={menu.y}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className="wn-context-item" {...pressProps(() => act(() => onNewSubfolder(folder)))}>
        {t('httpapi.newSubfolder')}
      </button>
      <button type="button" className="wn-context-item" {...pressProps(() => act(() => onRename(folder)))}>
        {t('httpapi.renameFolder')}
      </button>
      <button type="button" className="wn-context-item" {...pressProps(() => act(() => onNewApi(folder.id)))}>
        {t('httpapi.newRequestInFolder')}
      </button>
      <button
        type="button"
        className="wn-context-item wn-context-item-danger"
        {...pressProps(() => act(() => onDelete(folder)))}
      >
        {t('httpapi.deleteFolder')}
      </button>
    </ContextMenu>
  )
}

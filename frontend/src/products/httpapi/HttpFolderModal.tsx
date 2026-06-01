import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { HTTPFolder, HTTPSavedRequest } from '../../api/types'
import { ModalPortal } from '../../components/ModalPortal'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { nextHttpChildSortOrder } from './httpapiSort'
import { model } from '../../../wailsjs/go/models'

interface Props {
  open: boolean
  parentId?: string
  folder?: HTTPFolder | null
  folders?: HTTPFolder[]
  items?: HTTPSavedRequest[]
  onClose: () => void
  onSaved: () => void
}

/** HttpFolderModal 新建/重命名 HTTP 目录。 */
export function HttpFolderModal({
  open,
  parentId = '',
  folder = null,
  folders = [],
  items = [],
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n()
  const { setStatusMessage } = useAppStore()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const isEdit = !!folder?.id

  useEffect(() => {
    if (open) setName(folder?.name ?? '')
  }, [open, folder?.id, folder?.name])

  if (!open) return null

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setStatusMessage(t('httpapi.errFolderName'))
      return
    }
    setSaving(true)
    try {
      const pid = isEdit ? folder!.parentId || '' : parentId
      await api.saveHTTPFolder(
        model.HTTPFolderDO.createFrom({
          id: folder?.id ?? '',
          name: trimmed,
          parentId: pid,
          sortOrder: isEdit
            ? folder!.sortOrder
            : nextHttpChildSortOrder(folders, items, pid),
          createdAt: folder?.createdAt ?? 0,
          updatedAt: 0,
        }),
      )
      setStatusMessage(isEdit ? t('httpapi.folderRenamed') : t('httpapi.folderSaved'))
      onSaved()
      onClose()
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" onClick={onClose}>
        <div className="wn-modal httpapi-folder-modal" onClick={(e) => e.stopPropagation()} role="dialog">
          <header className="wn-modal-header wn-modal-header-bar">
            <h3 className="wn-modal-title">
              {isEdit ? t('httpapi.renameFolder') : t('httpapi.newFolder')}
            </h3>
            <button type="button" className="wn-modal-close-btn" onClick={onClose} aria-label={t('common.cancel')}>
              ×
            </button>
          </header>
          <div className="wn-modal-body">
            <label className="wn-label" htmlFor="http-folder-name">
              {t('httpapi.folderName')}
            </label>
            <input
              id="http-folder-name"
              className="wn-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('httpapi.folderNamePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              autoFocus
            />
          </div>
          <footer className="wn-modal-footer" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-primary"
              disabled={saving}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void submit()}
            >
              {t('common.confirm')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

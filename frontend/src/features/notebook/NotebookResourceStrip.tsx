import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'

type Asset = {
  id: string
  name: string
  url: string
  isImage?: boolean
  size?: number
}

type Props = {
  noteId: string
  refreshKey: number
  onForget: (fileName: string) => void
}

function fileNameOf(asset: Asset): string {
  const url = asset.url || ''
  const slash = url.lastIndexOf('/')
  const name = slash >= 0 ? url.slice(slash + 1) : url
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** NotebookResourceStrip 当前笔记已落在本机的截图和附件。 */
export function NotebookResourceStrip({ noteId, refreshKey, onForget }: Props) {
  const { t } = useI18n()
  const [items, setItems] = useState<Asset[]>([])

  const load = useCallback(async () => {
    if (!noteId) {
      setItems([])
      return
    }
    try {
      const list = (await api.listNotebookResources(noteId)) as Asset[]
      setItems(list)
    } catch {
      setItems([])
    }
  }, [noteId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const open = async (asset: Asset) => {
    const file = fileNameOf(asset)
    if (!file) return
    try {
      await api.openNotebookAsset(noteId, file)
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const reveal = async (id: string) => {
    try {
      await api.revealNotebookResource(id)
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const remove = async (asset: Asset) => {
    try {
      await api.deleteNotebookResource(asset.id)
      const file = fileNameOf(asset)
      if (file) onForget(file)
      notify.success(t('notebook.resourceDeleted'))
      await load()
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  if (!items.length) return null

  return (
    <div className="notebook-resource-strip" aria-label={t('notebook.resources')}>
      <span className="notebook-resource-label">{t('notebook.resources')}</span>
      <ul className="notebook-resource-list">
        {items.map((asset) => {
          const size = formatSize(asset.size || 0)
          return (
            <li key={asset.id} className="notebook-resource-chip" title={asset.name}>
              <button
                type="button"
                className="notebook-resource-name"
                title={t('notebook.openResource')}
                {...pressProps(() => void open(asset))}
              >
                {asset.isImage ? t('notebook.resourceImage') : t('notebook.resourceFile')} {asset.name}
              </button>
              {size ? <span className="notebook-resource-size">{size}</span> : null}
              <button
                type="button"
                className="notebook-resource-btn"
                {...pressProps(() => void reveal(asset.id))}
              >
                {t('notebook.revealInFinder')}
              </button>
              <button
                type="button"
                className="notebook-resource-btn is-danger"
                {...pressProps(() => void remove(asset))}
              >
                {t('common.delete')}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

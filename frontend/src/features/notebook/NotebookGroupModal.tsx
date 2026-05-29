import { useEffect, useState } from 'react'
import type { NotebookGroup } from '../../api/types'
import { useI18n } from '../../i18n'
import '../../components/ui.css'

interface NotebookGroupModalProps {
  open: boolean
  initial?: NotebookGroup | null
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}

/** NotebookGroupModal 新建/重命名笔记本分组。 */
export function NotebookGroupModal({ open, initial, onClose, onSubmit }: NotebookGroupModalProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setError('')
  }, [open, initial])

  if (!open) return null

  const submit = async () => {
    if (!name.trim()) {
      setError(t('notebook.errGroupName'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wn-modal-backdrop" onClick={onClose}>
      <div className="wn-modal wn-modal-compact" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="wn-modal-header">
          <h2 className="wn-modal-title">{initial ? t('notebook.editGroup') : t('notebook.newGroupModal')}</h2>
        </header>
        <div className="wn-modal-body">
          <label className="wn-field">
            <span>{t('environment.presetName')}</span>
            <input
              className="wn-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              autoFocus
            />
          </label>
          {error && <p className="wn-field-error">{error}</p>}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={() => void submit()}>
            {saving ? t('common.saving') : t('common.confirm')}
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { NotebookGroup } from '../../api/types'
import '../../components/ui.css'

interface NotebookGroupModalProps {
  open: boolean
  initial?: NotebookGroup | null
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}

/** NotebookGroupModal 新建/重命名笔记本分组。 */
export function NotebookGroupModal({ open, initial, onClose, onSubmit }: NotebookGroupModalProps) {
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
      setError('请输入分组名称')
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
          <h2 className="wn-modal-title">{initial ? '重命名分组' : '新建分组'}</h2>
        </header>
        <div className="wn-modal-body">
          <label className="wn-field">
            <span>名称</span>
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
            取消
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled={saving} onClick={() => void submit()}>
            {saving ? '保存中…' : '确定'}
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import '../../components/ui.css'
import { ModalPortal } from '../../components/compat'

interface Props {
  open: boolean
  columns: string[]
  onConfirm: (selected: string[]) => void
  onCancel: () => void
}

/** ExportFieldsDialog 导出前选择字段弹窗。 */
export function ExportFieldsDialog({ open, columns, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setSelected(new Set(columns))
    }
  }, [open, columns])

  const allSelected = columns.length > 0 && selected.size === columns.length
  const noneSelected = selected.size === 0

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(columns))
  const selectNone = () => setSelected(new Set())

  const orderedSelected = useMemo(
    () => columns.filter((c) => selected.has(c)),
    [columns, selected]
  )

  if (!open) return null

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" onClick={onCancel}>
        <div
          className="wn-modal wn-modal-compact"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-labelledby="export-fields-title"
        >
          <header className="wn-modal-header">
            <h2 id="export-fields-title" className="wn-modal-title">{t('database.exportFieldsTitle')}</h2>
            <p className="wn-modal-desc">
              {t('database.exportFieldsHint', { selected: selected.size, total: columns.length })}
            </p>
          </header>
          <div className="wn-modal-body export-fields-body">
            <div className="export-fields-actions">
              <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" onClick={selectAll} disabled={allSelected}>
                {t('database.exportSelectAll')}
              </button>
              <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" onClick={selectNone} disabled={noneSelected}>
                {t('database.exportSelectNone')}
              </button>
            </div>
            <ul className="export-fields-list">
              {columns.map((name) => (
                <li key={name} className="export-fields-item">
                  <label className="export-fields-label">
                    <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} />
                    <span className="export-fields-name" title={name}>{name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-tool" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-primary"
              disabled={noneSelected}
              onClick={() => onConfirm(orderedSelected)}
            >
              {t('database.exportConfirm')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

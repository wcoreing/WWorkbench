import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import '../../components/ui.css'
import { ModalPortal } from '../../components/compat'

interface Props {
  open: boolean
  mysql?: boolean
  onConfirm: (name: string, charset: string, collation: string) => void
  onCancel: () => void
}

/** CreateDatabaseDialog 新建数据库弹窗。 */
export function CreateDatabaseDialog({ open, mysql = true, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [charset, setCharset] = useState('utf8mb4')
  const [collation, setCollation] = useState('utf8mb4_unicode_ci')

  useEffect(() => {
    if (open) {
      setName('')
      setCharset('utf8mb4')
      setCollation('utf8mb4_unicode_ci')
    }
  }, [open])

  if (!open) return null

  const canSubmit = name.trim().length > 0

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" onClick={onCancel}>
        <div className="wn-modal wn-modal-compact" onClick={(e) => e.stopPropagation()} role="dialog">
          <header className="wn-modal-header">
            <h2 className="wn-modal-title">{t('database.createDatabaseTitle')}</h2>
            <p className="wn-modal-desc">{t('database.createDatabaseHint')}</p>
          </header>
          <div className="wn-modal-body">
            <label className="wn-field">
              <span className="wn-field-label">{t('database.databaseName')}</span>
              <input
                className="wn-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_database"
                autoFocus
              />
            </label>
            {mysql && (
              <>
                <label className="wn-field">
                  <span className="wn-field-label">{t('connection.charset')}</span>
                  <input className="wn-input" value={charset} onChange={(e) => setCharset(e.target.value)} />
                </label>
                <label className="wn-field">
                  <span className="wn-field-label">{t('database.collation')}</span>
                  <input className="wn-input" value={collation} onChange={(e) => setCollation(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-tool" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-primary"
              disabled={!canSubmit}
              onClick={() => onConfirm(name.trim(), charset.trim(), collation.trim())}
            >
              {t('common.create')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

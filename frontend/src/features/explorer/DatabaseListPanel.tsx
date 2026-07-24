import type { ObjectTreeNode } from '../../api/types'
import { useI18n } from '../../i18n'
import { isMysqlSystemDatabase } from './mysqlSystemDb'
import '../../components/ui.css'

interface Props {
  databases: ObjectTreeNode[]
  invalidDatabase?: string
  onSelect: (database: string) => void
  onCreateDatabase?: () => void
  onImportSQL?: () => void
}

/** DatabaseListPanel 未选库时展示数据库列表（Navicat 风格）。 */
export function DatabaseListPanel({
  databases,
  invalidDatabase,
  onSelect,
  onCreateDatabase,
  onImportSQL,
}: Props) {
  const { t } = useI18n()

  if (!databases.length) {
    return (
      <div className="database-list-panel">
        <div className="pane-empty">{t('database.noDatabases')}</div>
      </div>
    )
  }

  return (
    <div className="database-list-panel">
      <div className="database-list-head">
        <h2 className="database-list-title">{t('database.pickDatabaseTitle')}</h2>
        <p className="database-list-desc">
          {invalidDatabase
            ? t('database.invalidDatabaseHint', { name: invalidDatabase })
            : t('database.pickDatabaseHint')}
        </p>
        {(onCreateDatabase || onImportSQL) && (
          <div className="database-list-actions">
            {onCreateDatabase && (
              <button type="button" className="wn-btn wn-btn-tool wn-btn-sm wn-btn-accent" onClick={onCreateDatabase}>
                {t('database.createDatabase')}
              </button>
            )}
            {onImportSQL && (
              <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" onClick={onImportSQL}>
                {t('database.importSql')}
              </button>
            )}
          </div>
        )}
      </div>
      <ul className="database-list-grid">
        {databases.map((db) => (
          <li key={db.id}>
            <button
              type="button"
              className={`database-list-item${isMysqlSystemDatabase(db.label) ? ' system' : ''}`}
              onClick={() => db.database && onSelect(db.database)}
            >
              <span className="database-list-icon">{isMysqlSystemDatabase(db.label) ? '⚙' : '◆'}</span>
              <span className="database-list-name">{db.label}</span>
              {isMysqlSystemDatabase(db.label) && (
                <span className="database-list-tag">{t('database.systemDatabase')}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

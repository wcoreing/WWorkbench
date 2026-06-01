import { useI18n } from '../../i18n'
import type { HttpKVRow } from './httpUtils'
import { emptyKVRow } from './httpUtils'

interface Props {
  rows: HttpKVRow[]
  onChange: (rows: HttpKVRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

/** HttpKeyValueTable 可编辑的键值参数表。 */
export function HttpKeyValueTable({ rows, onChange, keyPlaceholder, valuePlaceholder }: Props) {
  const { t } = useI18n()

  const update = (index: number, patch: Partial<HttpKVRow>) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r))
    onChange(next)
  }

  const addRow = () => onChange([...rows, emptyKVRow()])

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    onChange(next.length ? next : [emptyKVRow()])
  }

  return (
    <div className="httpapi-kv-table">
      <div className="httpapi-kv-head">
        <span className="httpapi-kv-col-check" />
        <span className="httpapi-kv-col-key">{t('httpapi.kvKey')}</span>
        <span className="httpapi-kv-col-value">{t('httpapi.kvValue')}</span>
        <span className="httpapi-kv-col-actions" />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="httpapi-kv-row">
          <input
            type="checkbox"
            className="httpapi-kv-check"
            checked={row.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            title={t('httpapi.kvEnabled')}
          />
          <input
            className="wn-input httpapi-kv-input"
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={keyPlaceholder ?? t('httpapi.kvKeyPh')}
            spellCheck={false}
          />
          <input
            className="wn-input httpapi-kv-input"
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={valuePlaceholder ?? t('httpapi.kvValuePh')}
            spellCheck={false}
          />
          <button type="button" className="wn-btn wn-btn-icon wn-btn-xs" onClick={() => removeRow(i)} title={t('common.delete')}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="wn-btn wn-btn-xs wn-btn-ghost httpapi-kv-add" onClick={addRow}>
        + {t('httpapi.kvAdd')}
      </button>
    </div>
  )
}

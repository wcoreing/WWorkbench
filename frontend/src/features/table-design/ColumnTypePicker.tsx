import {
  columnTypeOptionsByCategory,
  formatColumnTypeSQL,
  getColumnTypeDef,
} from './mysqlColumnTypes'
import '../../components/ui.css'

interface Props {
  typeId: string
  length?: number
  precision?: number
  scale?: number
  onChange: (patch: { typeId: string; length?: number; precision?: number; scale?: number }) => void
}

/** ColumnTypePicker 字段类型选择（含长度/精度）。 */
export function ColumnTypePicker({ typeId, length, precision, scale, onChange }: Props) {
  const def = getColumnTypeDef(typeId)
  const preview = formatColumnTypeSQL(typeId, length, precision, scale)

  return (
    <div className="column-type-picker">
      <select
        className="wn-select column-type-select"
        value={typeId}
        onChange={(e) => onChange({ typeId: e.target.value })}
        title={preview}
      >
        {columnTypeOptionsByCategory().map((g) => (
          <optgroup key={g.category} label={g.category}>
            {g.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {def?.length && (
        <input
          type="number"
          className="wn-input column-type-param"
          min={def.length.min}
          max={def.length.max}
          value={length ?? def.length.default}
          onChange={(e) => onChange({ typeId, length: Number(e.target.value) || def.length!.default })}
          title="长度"
        />
      )}
      {def?.precision && (
        <>
          <input
            type="number"
            className="wn-input column-type-param"
            min={1}
            max={def.precision.precisionMax}
            value={precision ?? def.precision.precisionDefault}
            onChange={(e) =>
              onChange({
                typeId,
                precision: Number(e.target.value) || def.precision!.precisionDefault,
                scale,
              })
            }
            title="精度"
          />
          <input
            type="number"
            className="wn-input column-type-param"
            min={0}
            max={def.precision.scaleMax}
            value={scale ?? def.precision.scaleDefault}
            onChange={(e) =>
              onChange({
                typeId,
                precision,
                scale: Number(e.target.value) ?? def.precision!.scaleDefault,
              })
            }
            title="小数位"
          />
        </>
      )}
    </div>
  )
}

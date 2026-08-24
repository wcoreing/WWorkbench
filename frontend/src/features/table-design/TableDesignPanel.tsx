import type { ReactNode } from 'react'
import '../../components/ui.css'
import { pressProps } from '../../components/compat'
import { LoadingPane } from '../../components/LoadingHost'

export type TableDesignTab = 'fields' | 'indexes' | 'sql'

interface Props {
  subtitle: string
  tab: TableDesignTab
  onTabChange: (tab: TableDesignTab) => void
  fieldCount: number
  indexCount: number
  metaBar?: ReactNode
  loadingKey?: string
  loadingLabel?: string
  error?: string
  fieldsPane: ReactNode
  indexesPane: ReactNode
  sqlPreview: string
  sqlPlaceholder: string
  toolbar: ReactNode
}

/** TableDesignPanel 工作区表设计面板（Tab：字段 / 索引 / SQL）。 */
export function TableDesignPanel({
  subtitle,
  tab,
  onTabChange,
  fieldCount,
  indexCount,
  metaBar,
  loadingKey,
  loadingLabel = '加载表结构…',
  error,
  fieldsPane,
  indexesPane,
  sqlPreview,
  sqlPlaceholder,
  toolbar,
}: Props) {
  const body = (
    <>
      {tab === 'fields' && <div className="table-design-pane">{fieldsPane}</div>}
      {tab === 'indexes' && <div className="table-design-pane">{indexesPane}</div>}
      {tab === 'sql' && (
        <div className="table-design-pane table-design-sql-pane">
          <pre className="table-design-sql-preview">{sqlPreview || sqlPlaceholder}</pre>
        </div>
      )}
      {error && <div className="wn-form-msg error table-design-error">{error}</div>}
    </>
  )

  return (
    <div className="table-design-panel">
      <div className="table-design-top">
        <span className="table-design-subtitle">{subtitle}</span>
        <div className="table-design-actions">{toolbar}</div>
      </div>

      {metaBar && <div className="table-design-meta">{metaBar}</div>}

      <nav className="table-design-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`table-design-tab ${tab === 'fields' ? 'active' : ''}`}
          aria-selected={tab === 'fields'}
          {...pressProps(() => onTabChange('fields'))}
        >
          字段
          {fieldCount > 0 && <span className="table-design-tab-count">{fieldCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          className={`table-design-tab ${tab === 'indexes' ? 'active' : ''}`}
          aria-selected={tab === 'indexes'}
          {...pressProps(() => onTabChange('indexes'))}
        >
          索引
          {indexCount > 0 && <span className="table-design-tab-count">{indexCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          className={`table-design-tab ${tab === 'sql' ? 'active' : ''}`}
          aria-selected={tab === 'sql'}
          {...pressProps(() => onTabChange('sql'))}
        >
          SQL 预览
        </button>
      </nav>

      <div className="table-design-body">
        {loadingKey ? (
          <LoadingPane loadingKey={loadingKey} label={loadingLabel} minHeight={200}>
            {body}
          </LoadingPane>
        ) : (
          body
        )}
      </div>
    </div>
  )
}

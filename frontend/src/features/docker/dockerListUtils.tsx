import type { DockerContainer } from '../../api/types'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'

export const DOCKER_PAGE_SIZE = 20

/** paginateList 对列表分页切片。 */
export function paginateList<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
  }
}

/** clampPage 将页码限制在有效范围。 */
export function clampPage(page: number, total: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(1, page), totalPages)
}

/** mayHaveDatabase 启发式判断容器是否可能暴露数据库端口。 */
export function mayHaveDatabase(c: DockerContainer): boolean {
  const img = c.image.toLowerCase()
  if (img.includes('mysql') || img.includes('mariadb') || img.includes('postgres')) return true
  return c.ports.includes('3306') || c.ports.includes('5432') || c.ports.includes('3307')
}

interface DockerListBarProps {
  page: number
  total: number
  pageSize: number
  loading?: boolean
  acting?: boolean
  onPageChange: (page: number) => void
  onRefresh: () => void
}

/** DockerListBar 列表工具栏（刷新 + 分页）。 */
export function DockerListBar({
  page,
  total,
  pageSize,
  loading,
  acting,
  onPageChange,
  onRefresh,
}: DockerListBarProps) {
  const { t } = useI18n()
  const totalPages = Math.max(1, Math.ceil(Math.max(total, 1) / pageSize))
  const canPrev = total > 0 && page > 1
  const canNext = total > 0 && page < totalPages

  return (
    <div className="pane-toolbar docker-list-bar">
      <div className="pane-toolbar-start">
        <button
          type="button"
          className="wn-btn wn-btn-tool wn-btn-sm"
          disabled={loading || acting}
          {...pressProps(onRefresh, { disabled: loading || acting })}
        >
          {t('common.refresh')}
        </button>
        <span className="pane-meta">
          {total > 0
            ? t('common.listMeta', { total, page, totalPages })
            : t('common.noData')}
          {loading ? ` · ${t('common.loading')}` : ''}
        </span>
      </div>
      {total > 0 && (
        <div className="pane-toolbar-end">
          <button
            type="button"
            className="wn-btn wn-btn-tool wn-btn-sm"
            disabled={!canPrev || loading}
            {...pressProps(() => onPageChange(page - 1), { disabled: !canPrev || loading })}
          >
            {t('common.prevPage')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-tool wn-btn-sm"
            disabled={!canNext || loading}
            {...pressProps(() => onPageChange(page + 1), { disabled: !canNext || loading })}
          >
            {t('common.nextPage')}
          </button>
        </div>
      )}
    </div>
  )
}

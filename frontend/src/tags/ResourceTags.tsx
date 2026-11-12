import { pressProps } from '../components/compat'
import type { ResourceTag, ResourceTagActivate } from './types'

type Props = {
  tags: ResourceTag[]
  onActivate?: ResourceTagActivate
  className?: string
}

/** ResourceTags 资源右上角系统标签；可点项走 onActivate。 */
export function ResourceTags({ tags, onActivate, className }: Props) {
  if (!tags.length) return null
  return (
    <span className={`resource-tags${className ? ` ${className}` : ''}`} role="list">
      {tags.map((tag) => {
        const clickable = Boolean(tag.action && onActivate)
        const tone = tag.tone || 'neutral'
        const cls = `resource-tag is-${tone}${clickable ? ' is-action' : ''}`
        if (!clickable) {
          return (
            <span key={tag.id} className={cls} title={tag.title || tag.label} role="listitem">
              {tag.label}
            </span>
          )
        }
        return (
          <button
            key={tag.id}
            type="button"
            className={cls}
            title={tag.title || tag.label}
            role="listitem"
            {...pressProps(
              (e) => {
                e.stopPropagation()
                onActivate?.(tag)
              },
              { stop: true },
            )}
          >
            {tag.label}
          </button>
        )
      })}
    </span>
  )
}

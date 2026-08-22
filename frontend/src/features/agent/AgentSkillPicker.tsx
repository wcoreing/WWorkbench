import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import type { SkillRef } from './agentSkillSlash'

interface Props {
  open: boolean
  items: SkillRef[]
  activeIndex: number
  onPick: (item: SkillRef) => void
  onHoverIndex: (index: number) => void
}

/** AgentSkillPicker / 方法包选择弹出层。 */
export function AgentSkillPicker({ open, items, activeIndex, onPick, onHoverIndex }: Props) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector('.agent-mention-item.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  if (!open) return null

  return (
    <div className="agent-mention-picker agent-skill-picker" ref={listRef} role="listbox">
      <div className="agent-mention-section-title">{t('agent.skillPickerTitle')}</div>
      {items.length === 0 ? (
        <div className="agent-mention-empty">{t('agent.skillEmpty')}</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={`agent-mention-item${i === activeIndex ? ' is-active' : ''}`}
            onMouseEnter={() => onHoverIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(item)
            }}
          >
            <span className="agent-mention-icon agent-mention-icon-skill">/</span>
            <span className="agent-mention-meta">
              <span className="agent-mention-label">
                {item.name}
                <span className="agent-skill-id">/{item.id}</span>
              </span>
              {item.description && <span className="agent-mention-sublabel">{item.description}</span>}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

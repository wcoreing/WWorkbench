import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { menuStyle, useAnchoredMenu } from './AgentComposerMenus'
import type { SkillRef } from './agentSkillSlash'

interface Props {
  open: boolean
  items: SkillRef[]
  activeIndex: number
  anchorRef: RefObject<HTMLElement | null>
  onPick: (item: SkillRef) => void
  onHoverIndex: (index: number) => void
}

/** AgentSkillPicker / 方法包选择弹出层。 */
export function AgentSkillPicker({ open, items, activeIndex, anchorRef, onPick, onHoverIndex }: Props) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)
  const pos = useAnchoredMenu(open, anchorRef, true)

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector('.agent-mention-item.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, pos])

  if (!open || !pos) return null

  return createPortal(
    <div
      className="agent-mention-picker agent-mention-picker-portal agent-skill-picker"
      ref={listRef}
      role="listbox"
      style={menuStyle(pos)}
    >
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
    </div>,
    document.body,
  )
}

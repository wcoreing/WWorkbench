import { useEffect, useMemo, useRef } from 'react'
import { useI18n } from '../../i18n'
import type { AgentMentionMenuItem } from './agentMention'

interface Props {
  open: boolean
  items: AgentMentionMenuItem[]
  activeIndex: number
  onPick: (item: AgentMentionMenuItem) => void
  onHoverIndex: (index: number) => void
}

/** AgentMentionPicker @ 资源选择弹出层。 */
export function AgentMentionPicker({ open, items, activeIndex, onPick, onHoverIndex }: Props) {
  const { t } = useI18n()
  const listRef = useRef<HTMLDivElement>(null)

  const grouped = useMemo(() => {
    const ssh = items.filter((i) => i.kind === 'ssh')
    const db = items.filter((i) => i.kind === 'database')
    const containers = items.filter((i) => i.kind === 'docker' && i.id.startsWith('docker:'))
    const docker = items.filter((i) => i.kind === 'docker' && !i.id.startsWith('docker:'))
    return { ssh, db, containers, docker }
  }, [items])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector('.agent-mention-item.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  if (!open) return null

  let idx = 0

  const renderSection = (title: string, section: AgentMentionMenuItem[]) => {
    if (section.length === 0) return null
    return (
      <div key={title} className="agent-mention-section">
        <div className="agent-mention-section-title">{title}</div>
        {section.map((item) => {
          const i = idx
          idx += 1
          return (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              className={`agent-mention-item${i === activeIndex ? ' is-active' : ''}`}
              onMouseEnter={() => onHoverIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(item)
              }}
            >
              <span className={`agent-mention-icon agent-mention-icon-${item.kind}`}>
                {item.kind === 'ssh' ? 'SSH' : item.kind === 'docker' ? (item.id.startsWith('docker:') ? 'CT' : 'DK') : 'DB'}
              </span>
              <span className="agent-mention-meta">
                <span className="agent-mention-label">{item.label}</span>
                {item.sublabel && <span className="agent-mention-sublabel">{item.sublabel}</span>}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="agent-mention-picker" ref={listRef} role="listbox">
      {items.length === 0 ? (
        <div className="agent-mention-empty">{t('agent.mentionEmpty')}</div>
      ) : (
        <>
          {renderSection(t('agent.mentionSSH'), grouped.ssh)}
          {renderSection(t('agent.mentionDatabase'), grouped.db)}
          {renderSection(t('agent.mentionContainer'), grouped.containers)}
          {renderSection(t('agent.mentionDocker'), grouped.docker)}
        </>
      )}
    </div>
  )
}

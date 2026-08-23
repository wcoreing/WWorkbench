interface AgentThreadItem {
  id: string
  title: string
  updatedAt: number
}

interface Props {
  threads: AgentThreadItem[]
  activeThreadId: string
  emptyHint: string
  onOpen: (id: string) => void
}

/** AgentThreadHistory 历史对话列表。 */
export function AgentThreadHistory({ threads, activeThreadId, emptyHint, onOpen }: Props) {
  return (
    <div className="agent-history">
      {threads.length === 0 && <div className="empty-hint">{emptyHint}</div>}
      {threads.map((th) => (
        <button
          key={th.id}
          type="button"
          className={`agent-history-item${activeThreadId === th.id ? ' is-active' : ''}`}
          onClick={() => onOpen(th.id)}
        >
          <span className="agent-history-title">{th.title}</span>
        </button>
      ))}
    </div>
  )
}

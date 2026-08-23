import { useI18n } from '../../i18n'
import type { AgentConfirmEvent, AgentConfirmItem } from '../../api/agentEvents'

interface SqlPreview {
  sql?: string
  database?: string
  sessionId?: string
  sqlKind?: string
}

interface HttpPreview {
  method?: string
  url?: string
  body?: string
}

interface DockerPreview {
  action?: string
  contextId?: string
  containerId?: string
  command?: string
}

/** parseRecordPreview 将 preview 解析为键值对象。 */
function parseRecordPreview(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as Record<string, unknown>
}

interface Props {
  pending: AgentConfirmEvent
  onApprove: () => void
  onReject: () => void
}

const DOCKER_MUTATE_TOOLS = new Set(['start_container', 'stop_container', 'remove_container'])

function dockerActionLabel(
  tool: string,
  action: string | undefined,
  t: (key: string) => string,
): string {
  if (action === 'start') return t('agent.confirmDockerStart')
  if (action === 'stop') return t('agent.confirmDockerStop')
  if (action === 'remove') return t('agent.confirmDockerRemove')
  return tool
}

function ItemDetail({ tool, preview }: { tool: string; preview?: unknown }) {
  const { t } = useI18n()
  const rec = parseRecordPreview(preview)

  const sqlPreview: SqlPreview | null =
    tool === 'execute_sql' && rec
      ? {
          sql: String(rec.sql ?? ''),
          database: String(rec.database ?? ''),
          sessionId: String(rec.sessionId ?? ''),
          sqlKind: String(rec.sqlKind ?? 'write'),
        }
      : null

  const httpPreview: HttpPreview | null =
    tool === 'execute_http' && rec
      ? {
          method: String(rec.method ?? 'GET'),
          url: String(rec.url ?? ''),
          body: String(rec.body ?? ''),
        }
      : null

  const dockerPreview: DockerPreview | null =
    DOCKER_MUTATE_TOOLS.has(tool) && rec
      ? {
          action: String(rec.action ?? ''),
          contextId: String(rec.contextId ?? ''),
          containerId: String(rec.containerId ?? ''),
          command: String(rec.command ?? ''),
        }
      : null

  if (sqlPreview?.sql) {
    return (
      <div className="agent-confirm-detail">
        <div className="agent-confirm-detail-meta">
          {sqlPreview.database && (
            <span>
              {t('agent.confirmDatabase')}: {sqlPreview.database}
            </span>
          )}
          {sqlPreview.sqlKind && (
            <span className="agent-confirm-badge">{t('agent.confirmSqlWrite')}</span>
          )}
        </div>
        <pre className="agent-confirm-sql">{sqlPreview.sql}</pre>
      </div>
    )
  }

  if (httpPreview?.url) {
    return (
      <div className="agent-confirm-detail">
        <div className="agent-confirm-detail-meta">
          <span className="agent-confirm-badge">{httpPreview.method}</span>
          <span className="agent-confirm-url">{httpPreview.url}</span>
        </div>
        {httpPreview.body?.trim() && (
          <pre className="agent-confirm-sql">{httpPreview.body}</pre>
        )}
      </div>
    )
  }

  if (dockerPreview) {
    return (
      <div className="agent-confirm-detail">
        <div className="agent-confirm-detail-meta">
          <span className="agent-confirm-badge">
            {dockerActionLabel(tool, dockerPreview.action, t)}
          </span>
          {dockerPreview.containerId && (
            <span>
              {t('agent.confirmDockerContainer')}: {dockerPreview.containerId}
            </span>
          )}
          {dockerPreview.contextId && (
            <span>
              {t('agent.confirmDockerContext')}: {dockerPreview.contextId}
            </span>
          )}
        </div>
        {dockerPreview.command && (
          <>
            <div className="agent-confirm-detail-label">{t('agent.confirmPendingCommand')}</div>
            <pre className="agent-confirm-sql">{dockerPreview.command}</pre>
          </>
        )}
      </div>
    )
  }

  return null
}

function BatchItemRow({ item }: { item: AgentConfirmItem }) {
  const { t } = useI18n()
  const rec = parseRecordPreview(item.preview)
  const containerId =
    DOCKER_MUTATE_TOOLS.has(item.tool) && rec ? String(rec.containerId ?? '') : ''
  const sql = item.tool === 'execute_sql' && rec ? String(rec.sql ?? '') : ''
  const httpURL = item.tool === 'execute_http' && rec ? String(rec.url ?? '') : ''
  const label = containerId || item.summary || item.tool
  return (
    <li className="agent-confirm-item">
      <div className="agent-confirm-item-head">
        <span className="agent-confirm-badge">
          {dockerActionLabel(
            item.tool,
            rec ? String(rec.action ?? '') : undefined,
            t,
          )}
        </span>
        <span className="agent-confirm-item-label">{label}</span>
      </div>
      {sql ? <pre className="agent-confirm-sql agent-confirm-sql-compact">{sql}</pre> : null}
      {httpURL ? (
        <div className="agent-confirm-item-meta">
          <span className="agent-confirm-badge">{String(rec?.method ?? 'GET')}</span>
          <span className="agent-confirm-url">{httpURL}</span>
        </div>
      ) : null}
    </li>
  )
}

/** AgentConfirmPanel 工具执行前确认（支持同轮多条一批批准/拒绝）。 */
export function AgentConfirmPanel({ pending, onApprove, onReject }: Props) {
  const { t } = useI18n()
  const items =
    pending.items && pending.items.length > 0
      ? pending.items
      : ([
          {
            pendingId: pending.pendingId,
            tool: pending.tool,
            summary: pending.summary,
            preview: pending.preview,
          },
        ] satisfies AgentConfirmItem[])
  const batch = items.length > 1

  return (
    <div className="agent-confirm">
      <p className="agent-confirm-summary">{pending.summary}</p>
      {batch ? (
        <ul className="agent-confirm-list">
          {items.map((it) => (
            <BatchItemRow key={it.pendingId} item={it} />
          ))}
        </ul>
      ) : (
        <ItemDetail tool={items[0].tool} preview={items[0].preview} />
      )}
      <div className="agent-confirm-actions">
        <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={onApprove}>
          {batch ? t('agent.approveAll') : t('agent.approve')}
        </button>
        <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" onClick={onReject}>
          {batch ? t('agent.rejectAll') : t('agent.reject')}
        </button>
      </div>
    </div>
  )
}

import { useI18n } from '../../i18n'
import type { AgentConfirmEvent } from '../../api/agentEvents'

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

/** AgentConfirmPanel 工具执行前确认（SQL / HTTP / Docker 等预览）。 */
export function AgentConfirmPanel({ pending, onApprove, onReject }: Props) {
  const { t } = useI18n()
  const rec = parseRecordPreview(pending.preview)

  const sqlPreview: SqlPreview | null =
    pending.tool === 'execute_sql' && rec
      ? {
          sql: String(rec.sql ?? ''),
          database: String(rec.database ?? ''),
          sessionId: String(rec.sessionId ?? ''),
          sqlKind: String(rec.sqlKind ?? 'write'),
        }
      : null

  const httpPreview: HttpPreview | null =
    pending.tool === 'execute_http' && rec
      ? {
          method: String(rec.method ?? 'GET'),
          url: String(rec.url ?? ''),
          body: String(rec.body ?? ''),
        }
      : null

  const dockerPreview: DockerPreview | null =
    DOCKER_MUTATE_TOOLS.has(pending.tool) && rec
      ? {
          action: String(rec.action ?? ''),
          contextId: String(rec.contextId ?? ''),
          containerId: String(rec.containerId ?? ''),
          command: String(rec.command ?? ''),
        }
      : null

  const dockerActionLabel =
    dockerPreview?.action === 'start'
      ? t('agent.confirmDockerStart')
      : dockerPreview?.action === 'stop'
        ? t('agent.confirmDockerStop')
        : dockerPreview?.action === 'remove'
          ? t('agent.confirmDockerRemove')
          : pending.tool

  return (
    <div className="agent-confirm">
      <p className="agent-confirm-summary">{pending.summary}</p>
      {sqlPreview?.sql && (
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
      )}
      {httpPreview?.url && (
        <div className="agent-confirm-detail">
          <div className="agent-confirm-detail-meta">
            <span className="agent-confirm-badge">{httpPreview.method}</span>
            <span className="agent-confirm-url">{httpPreview.url}</span>
          </div>
          {httpPreview.body?.trim() && (
            <pre className="agent-confirm-sql">{httpPreview.body}</pre>
          )}
        </div>
      )}
      {dockerPreview && (
        <div className="agent-confirm-detail">
          <div className="agent-confirm-detail-meta">
            <span className="agent-confirm-badge">{dockerActionLabel}</span>
            {dockerPreview.contextId && (
              <span>
                {t('agent.confirmDockerContext')}: {dockerPreview.contextId}
              </span>
            )}
            {dockerPreview.containerId && (
              <span>
                {t('agent.confirmDockerContainer')}: {dockerPreview.containerId}
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
      )}
      <div className="agent-confirm-actions">
        <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={onApprove}>
          {t('agent.approve')}
        </button>
        <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" onClick={onReject}>
          {t('agent.reject')}
        </button>
      </div>
    </div>
  )
}

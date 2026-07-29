import type { AgentMention } from './agentMention'
import { useAgentStore } from '../../stores/agentStore'

/** AgentDraftPayload 打开 AI 侧栏时预填的内容。 */
export interface AgentDraftPayload {
  mentions: AgentMention[]
  message?: string
}

/** openAgentDraft 打开 AI 侧栏并填入 @ 资源与提示语。 */
export function openAgentDraft(payload: AgentDraftPayload) {
  useAgentStore.getState().applyDraft(payload)
}

/** mentionSSH 构造 SSH @ 资源。 */
export function mentionSSH(host: { id: string; name?: string; host: string }): AgentMention {
  return {
    kind: 'ssh',
    id: host.id,
    label: host.name?.trim() || host.host,
  }
}

/** mentionDockerHost 构造已注册 Docker 容器主机 @ 资源。 */
export function mentionDockerHost(host: {
  id: string
  name?: string
  image?: string
  containerId?: string
}): AgentMention {
  return {
    kind: 'docker',
    id: host.id,
    label: host.name?.trim() || host.containerId?.slice(0, 12) || host.id,
    sublabel: host.image || host.containerId?.slice(0, 12),
  }
}

/** mentionDatabase 构造数据库 @ 资源。 */
export function mentionDatabase(conn: {
  id: string
  name?: string
  host: string
  dbType: string
}): AgentMention {
  return {
    kind: 'database',
    id: conn.id,
    label: conn.name?.trim() || conn.host,
    sublabel: conn.dbType,
  }
}

/** mentionLogSource 构造日志源 @ 资源。 */
export function mentionLogSource(src: { id: string; name: string }): AgentMention {
  return { kind: 'log', id: src.id, label: src.name?.trim() || src.id }
}

/** mentionHttpRequest 构造 HTTP 请求 @ 资源。 */
export function mentionHttpRequest(req: {
  id: string
  name?: string
  method?: string
  url?: string
}): AgentMention {
  return {
    kind: 'http',
    id: req.id,
    label: req.name?.trim() || req.url || req.id,
    sublabel: req.method,
  }
}

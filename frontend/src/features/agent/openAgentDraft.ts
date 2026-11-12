import type { AgentMention } from './agentMention'
import { useAgentStore } from '../../stores/agentStore'
import type { AgentChatMode } from './agentChatMode'

/** AgentDraftPayload 打开 AI 侧栏时预填的内容。 */
export interface AgentDraftPayload {
  mentions: AgentMention[]
  message?: string
  skillIds?: string[]
  /** true：打开侧栏后自动发送，由侧栏 Agent 接管。 */
  autoSend?: boolean
  /** 发送前切换模式；autoSend 默认 agent。 */
  mode?: AgentChatMode
}

/** openAgentDraft 打开 AI 侧栏并填入 @ 资源与提示语；可自动发送。 */
export function openAgentDraft(payload: AgentDraftPayload) {
  const store = useAgentStore.getState()
  const mode = payload.mode ?? (payload.autoSend ? 'agent' : undefined)
  if (mode) store.setChatMode(mode)
  store.applyDraft(payload)
}

/** mentionSSH 构造 SSH @ 资源。 */
export function mentionSSH(host: {
  id: string
  name?: string
  host: string
  user?: string
  port?: number
}): AgentMention {
  const user = host.user?.trim() || 'root'
  const port = host.port && host.port > 0 ? host.port : 22
  return {
    kind: 'ssh',
    id: host.id,
    label: host.name?.trim() || host.host,
    sublabel: `${user}@${host.host}:${port}`,
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

/** mentionNote 构造笔记本 @ 资源（拖入 AI 侧栏 / 草稿）。 */
export function mentionNote(note: { id: string; title?: string }): AgentMention {
  const id = note.id.trim()
  const label = (note.title || '').trim() || id.split('/').pop() || id
  return {
    kind: 'note',
    id,
    label,
    sublabel: id.includes('/') ? id : undefined,
  }
}

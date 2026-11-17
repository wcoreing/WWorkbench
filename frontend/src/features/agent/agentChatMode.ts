/** AgentChatMode 输入栏模式（Cursor 同款：Ask / Agent / Plan）。 */
export type AgentChatMode = 'ask' | 'agent' | 'plan'

const STORAGE_MODE = 'agent_chat_mode'
const STORAGE_SAVED_MODELS = 'agent_saved_models'
const MAX_SAVED = 8

/** AGENT_CHAT_MODES 模式顺序。 */
export const AGENT_CHAT_MODES: AgentChatMode[] = ['agent', 'ask', 'plan']

/** normalizeChatMode 归一化模式。 */
export function normalizeChatMode(raw: string | undefined | null): AgentChatMode {
  const s = String(raw || '').toLowerCase()
  if (s === 'ask' || s === 'plan') return s
  return 'agent'
}

/** loadChatMode 读取上次模式。 */
export function loadChatMode(): AgentChatMode {
  try {
    return normalizeChatMode(localStorage.getItem(STORAGE_MODE))
  } catch {
    return 'agent'
  }
}

/** persistChatMode 记住模式。 */
export function persistChatMode(mode: AgentChatMode) {
  try {
    localStorage.setItem(STORAGE_MODE, mode)
  } catch {
    /* ignore */
  }
}

type SavedModelMap = Record<string, string[]>

function readSavedModels(): SavedModelMap {
  try {
    const raw = localStorage.getItem(STORAGE_SAVED_MODELS)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: SavedModelMap = {}
    for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const ids = value.map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_SAVED)
      if (ids.length) out[provider] = ids
    }
    return out
  } catch {
    return {}
  }
}

/** loadSavedModels 该服务商保存过的模型，新的在前。 */
export function loadSavedModels(provider: string): string[] {
  return readSavedModels()[provider.trim() || 'other'] || []
}

/** rememberSavedModel 把已保存的模型记到该服务商下。 */
export function rememberSavedModel(provider: string, id: string) {
  const model = id.trim()
  const key = provider.trim() || 'other'
  if (!model) return
  const map = readSavedModels()
  map[key] = [model, ...(map[key] || []).filter((x) => x !== model)].slice(0, MAX_SAVED)
  try {
    localStorage.setItem(STORAGE_SAVED_MODELS, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

/** composeModelOptions 当前模型 + 该服务商保存过的，去重。 */
export function composeModelOptions(current: string, provider: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [current, ...loadSavedModels(provider)]) {
    const v = id.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

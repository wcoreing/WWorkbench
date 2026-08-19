/** AgentChatMode 输入栏模式（Cursor 同款：Ask / Agent / Plan）。 */
export type AgentChatMode = 'ask' | 'agent' | 'plan'

const STORAGE_MODE = 'agent_chat_mode'
const STORAGE_MODELS = 'agent_recent_models'
const MAX_RECENT = 6

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

/** suggestedModels 当前服务商的快捷模型（不作为能力白名单）。 */
export function suggestedModels(provider: string): string[] {
  switch (provider) {
    case 'deepseek':
      return ['deepseek-v4-pro', 'deepseek-v4-flash']
    case 'minimax':
      return ['MiniMax-M2.5', 'MiniMax-M3']
    case 'bailian':
      return ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-vl-plus']
    default:
      return []
  }
}

/** loadRecentModels 最近用过的模型 id。 */
export function loadRecentModels(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_MODELS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

/** rememberRecentModel 把模型记到最近使用。 */
export function rememberRecentModel(id: string) {
  const model = id.trim()
  if (!model) return
  const next = [model, ...loadRecentModels().filter((x) => x !== model)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(STORAGE_MODELS, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

/** composeModelOptions 当前 + 最近 + 预设，去重。 */
export function composeModelOptions(current: string, provider: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [current, ...loadRecentModels(), ...suggestedModels(provider)]) {
    const v = id.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

import { create } from 'zustand'
import type { AgentMention } from '../features/agent/agentMention'
import type { AgentPanelView } from '../features/agent/agentTypes'
import { loadChatMode, persistChatMode, type AgentChatMode } from '../features/agent/agentChatMode'

const STORAGE_OPEN = 'agent_panel_open'
const STORAGE_THREAD = 'agent_thread_id'

export interface AgentChatLine {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  mentions?: AgentMention[]
  skillIds?: string[]
  images?: { mime: string; data: string }[]
  /** history_message.seq；用于 thread#seq 查日志 */
  seq?: number
  /** 本条 assistant 下挂的工具（可折叠，对齐 Cursor） */
  tools?: AgentToolStep[]
}

let lineSeq = 0

/** nextAgentLineId 生成消息行 ID。 */
export function nextAgentLineId() {
  lineSeq += 1
  return `line-${lineSeq}`
}

/** loadAgentPanelOpen 读取侧栏是否展开。 */
function loadAgentPanelOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_OPEN) === '1'
  } catch {
    return false
  }
}

/** persistAgentPanelOpen 持久化侧栏展开状态。 */
function persistAgentPanelOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_OPEN, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** loadAgentThreadId 读取上次对话 threadId。 */
function loadAgentThreadId(): string {
  try {
    return localStorage.getItem(STORAGE_THREAD) || ''
  } catch {
    return ''
  }
}

/** persistAgentThreadId 持久化当前对话 threadId。 */
function persistAgentThreadId(threadId: string) {
  try {
    if (threadId) localStorage.setItem(STORAGE_THREAD, threadId)
    else localStorage.removeItem(STORAGE_THREAD)
  } catch {
    /* ignore */
  }
}

/** AgentToolStep 工具调用轨迹步骤。 */
export interface AgentToolStep {
  id: string
  tool: string
  status: 'running' | 'ok' | 'error' | 'denied' | 'need_confirm' | 'need_choice' | ''
  argsPreview?: string
  summary?: string
}

interface AgentStore {
  panelOpen: boolean
  view: AgentPanelView
  threadId: string
  lines: AgentChatLine[]
  streamingLineId: string | null
  /** 流式正文缓冲：与 lines 分离，避免每 token 复制整表 messages。 */
  streamingDraft: string
  draftInput: string
  draftMentions: AgentMention[]
  draftSkillIds: string[]
  draftTick: number
  toolSteps: AgentToolStep[]
  threadMentions: AgentMention[]
  threadSkillIds: string[]
  pendingTurnSkillIds: string[]
  chatMode: AgentChatMode
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setView: (view: AgentPanelView) => void
  setThreadId: (id: string) => void
  appendLine: (line: AgentChatLine) => void
  setLines: (lines: AgentChatLine[] | ((prev: AgentChatLine[]) => AgentChatLine[])) => void
  resetThread: () => void
  beginStreaming: () => void
  appendStreamDelta: (delta: string) => void
  finishStreaming: (fullContent: string, seq?: number) => void
  cancelStreaming: () => void
  applyDraft: (payload: { message?: string; mentions: AgentMention[]; skillIds?: string[] }) => void
  pushToolStep: (tool: string, argsPreview?: string) => string
  finishToolStep: (tool: string, status?: AgentToolStep['status'], summary?: string) => void
  clearToolSteps: () => void
  setThreadMentions: (mentions: AgentMention[]) => void
  setThreadSkillIds: (ids: string[]) => void
  setPendingTurnSkillIds: (ids: string[]) => void
  setChatMode: (mode: AgentChatMode) => void
}

/** useAgentStore AI 侧栏与对话状态（收起不丢会话）。 */
export const useAgentStore = create<AgentStore>((set) => ({
  panelOpen: loadAgentPanelOpen(),
  view: 'chat',
  threadId: loadAgentThreadId(),
  lines: [],
  streamingLineId: null,
  streamingDraft: '',
  draftInput: '',
  draftMentions: [],
  draftSkillIds: [],
  draftTick: 0,
  toolSteps: [],
  threadMentions: [],
  threadSkillIds: [],
  pendingTurnSkillIds: [],
  chatMode: loadChatMode(),
  setPanelOpen: (open) => {
    persistAgentPanelOpen(open)
    set({ panelOpen: open })
  },
  togglePanel: () =>
    set((s) => {
      const open = !s.panelOpen
      persistAgentPanelOpen(open)
      return { panelOpen: open }
    }),
  setView: (view) => set({ view }),
  setThreadId: (threadId) => {
    persistAgentThreadId(threadId)
    set({ threadId })
  },
  appendLine: (line) => set((s) => ({ lines: [...s.lines, line] })),
  setLines: (lines) =>
    set((s) => ({
      lines: typeof lines === 'function' ? lines(s.lines) : lines,
    })),
  resetThread: () => {
    persistAgentThreadId('')
    set({
      threadId: '',
      lines: [],
      streamingLineId: null,
      streamingDraft: '',
      view: 'chat',
      toolSteps: [],
      threadMentions: [],
      threadSkillIds: [],
      pendingTurnSkillIds: [],
    })
  },
  setThreadMentions: (threadMentions) => set({ threadMentions }),
  setThreadSkillIds: (threadSkillIds) => set({ threadSkillIds }),
  setPendingTurnSkillIds: (pendingTurnSkillIds) => set({ pendingTurnSkillIds }),
  setChatMode: (chatMode) => {
    persistChatMode(chatMode)
    set({ chatMode })
  },
  applyDraft: (payload) =>
    set((s) => ({
      panelOpen: true,
      view: 'chat',
      draftInput: payload.message ?? '',
      draftMentions: payload.mentions,
      draftSkillIds: payload.skillIds ?? [],
      draftTick: s.draftTick + 1,
    })),
  pushToolStep: (tool, argsPreview) => {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => {
      let lines = [...s.lines]
      let streamingLineId = s.streamingLineId
      let streamingDraft = s.streamingDraft
      if (streamingLineId) {
        const cur = lines.find((ln) => ln.id === streamingLineId)
        if (streamingDraft.trim()) {
          lines = lines.map((ln) =>
            ln.id === streamingLineId ? { ...ln, content: streamingDraft } : ln,
          )
        } else if (!cur?.content.trim() && !(cur?.tools && cur.tools.length)) {
          lines = lines.filter((ln) => ln.id !== streamingLineId)
        }
        streamingLineId = null
        streamingDraft = ''
      }
      let idx = -1
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].role === 'assistant') {
          idx = i
          break
        }
      }
      if (idx < 0) {
        const nid = nextAgentLineId()
        lines.push({ id: nid, role: 'assistant', content: '', tools: [] })
        idx = lines.length - 1
      }
      const ln = lines[idx]
      lines[idx] = {
        ...ln,
        tools: [...(ln.tools || []), { id, tool, status: 'running', argsPreview }],
      }
      return { lines, streamingLineId, streamingDraft, toolSteps: [] }
    })
    return id
  },
  finishToolStep: (tool, status = 'ok', summary) =>
    set((s) => {
      const lines = s.lines.map((ln) => ({ ...ln, tools: ln.tools ? [...ln.tools] : undefined }))
      for (let i = lines.length - 1; i >= 0; i--) {
        const tools = lines[i].tools
        if (!tools?.length) continue
        const ti = tools.findIndex((step) => step.tool === tool && step.status === 'running')
        if (ti < 0) continue
        tools[ti] = { ...tools[ti], status, summary }
        lines[i] = { ...lines[i], tools }
        break
      }
      return { lines, toolSteps: [] }
    }),
  clearToolSteps: () => set({ toolSteps: [] }),
  beginStreaming: () => {
    const id = nextAgentLineId()
    set((s) => ({
      streamingLineId: id,
      streamingDraft: '',
      lines: [...s.lines, { id, role: 'assistant', content: '', tools: [] }],
    }))
  },
  appendStreamDelta: (delta) =>
    set((s) => {
      if (!s.streamingLineId || !delta) return s
      return { streamingDraft: s.streamingDraft + delta }
    }),
  finishStreaming: (fullContent, seq) =>
    set((s) => {
      const sid = s.streamingLineId
      if (!sid) return { streamingLineId: null, streamingDraft: '' }
      const merged = fullContent || s.streamingDraft
      const turnSkills = s.pendingTurnSkillIds.length ? [...s.pendingTurnSkillIds] : undefined
      return {
        streamingLineId: null,
        streamingDraft: '',
        pendingTurnSkillIds: [],
        lines: s.lines.map((ln) =>
          ln.id === sid
            ? {
                ...ln,
                content: merged || ln.content,
                seq: seq ?? ln.seq,
                skillIds: turnSkills ?? ln.skillIds,
              }
            : ln,
        ),
      }
    }),
  cancelStreaming: () =>
    set((s) => {
      const sid = s.streamingLineId
      if (!sid) return s
      const line = s.lines.find((ln) => ln.id === sid)
      const text = (line?.content.trim() || s.streamingDraft.trim()) ?? ''
      const hasTools = !!(line?.tools && line.tools.length)
      if (!text && !hasTools) {
        return {
          streamingLineId: null,
          streamingDraft: '',
          lines: s.lines.filter((ln) => ln.id !== sid),
        }
      }
      return {
        streamingLineId: null,
        streamingDraft: '',
        lines: text && !line?.content.trim()
          ? s.lines.map((ln) => (ln.id === sid ? { ...ln, content: s.streamingDraft } : ln))
          : s.lines,
      }
    }),
}))


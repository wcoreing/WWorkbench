import { create } from 'zustand'
import type { AgentMention } from '../features/agent/agentMention'
import type { AgentPanelView } from '../features/agent/agentTypes'
import { loadChatMode, persistChatMode, type AgentChatMode } from '../features/agent/agentChatMode'

const STORAGE_OPEN = 'agent_panel_open'

export interface AgentChatLine {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  mentions?: AgentMention[]
  images?: { mime: string; data: string }[]
  /** history_message.seq；有值时可「截到此处」 */
  seq?: number
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

/** AgentToolStep 工具调用轨迹步骤。 */
export interface AgentToolStep {
  id: string
  tool: string
  status: 'running' | 'ok' | 'error' | 'denied' | 'need_confirm'
  argsPreview?: string
  summary?: string
}

interface AgentStore {
  panelOpen: boolean
  view: AgentPanelView
  threadId: string
  lines: AgentChatLine[]
  streamingLineId: string | null
  draftInput: string
  draftMentions: AgentMention[]
  draftTick: number
  toolSteps: AgentToolStep[]
  threadMentions: AgentMention[]
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
  applyDraft: (payload: { message?: string; mentions: AgentMention[] }) => void
  pushToolStep: (tool: string, argsPreview?: string) => string
  finishToolStep: (tool: string, status?: AgentToolStep['status'], summary?: string) => void
  clearToolSteps: () => void
  setThreadMentions: (mentions: AgentMention[]) => void
  setChatMode: (mode: AgentChatMode) => void
}

/** useAgentStore AI 侧栏与对话状态（收起不丢会话）。 */
export const useAgentStore = create<AgentStore>((set) => ({
  panelOpen: loadAgentPanelOpen(),
  view: 'chat',
  threadId: '',
  lines: [],
  streamingLineId: null,
  draftInput: '',
  draftMentions: [],
  draftTick: 0,
  toolSteps: [],
  threadMentions: [],
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
  setThreadId: (threadId) => set({ threadId }),
  appendLine: (line) => set((s) => ({ lines: [...s.lines, line] })),
  setLines: (lines) =>
    set((s) => ({
      lines: typeof lines === 'function' ? lines(s.lines) : lines,
    })),
  resetThread: () =>
    set({ threadId: '', lines: [], streamingLineId: null, view: 'chat', toolSteps: [], threadMentions: [] }),
  setThreadMentions: (threadMentions) => set({ threadMentions }),
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
      draftTick: s.draftTick + 1,
    })),
  pushToolStep: (tool, argsPreview) => {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => ({
      toolSteps: [...s.toolSteps, { id, tool, status: 'running', argsPreview }],
    }))
    return id
  },
  finishToolStep: (tool, status = 'ok', summary) =>
    set((s) => {
      let matched = false
      const toolSteps = s.toolSteps.map((step) => {
        if (!matched && step.tool === tool && step.status === 'running') {
          matched = true
          return { ...step, status, summary }
        }
        return step
      })
      return { toolSteps }
    }),
  clearToolSteps: () => set({ toolSteps: [] }),
  beginStreaming: () => {
    const id = nextAgentLineId()
    set((s) => ({
      streamingLineId: id,
      lines: [...s.lines, { id, role: 'assistant', content: '' }],
    }))
  },
  appendStreamDelta: (delta) =>
    set((s) => {
      const sid = s.streamingLineId
      if (!sid || !delta) return s
      return {
        lines: s.lines.map((ln) =>
          ln.id === sid ? { ...ln, content: ln.content + delta } : ln,
        ),
      }
    }),
  finishStreaming: (fullContent, seq) =>
    set((s) => {
      const sid = s.streamingLineId
      if (!sid) return { streamingLineId: null }
      return {
        streamingLineId: null,
        lines: s.lines.map((ln) =>
          ln.id === sid
            ? { ...ln, content: fullContent || ln.content, seq: seq ?? ln.seq }
            : ln,
        ),
      }
    }),
  cancelStreaming: () =>
    set((s) => {
      const sid = s.streamingLineId
      if (!sid) return s
      const line = s.lines.find((ln) => ln.id === sid)
      if (!line?.content.trim()) {
        return {
          streamingLineId: null,
          lines: s.lines.filter((ln) => ln.id !== sid),
        }
      }
      return { streamingLineId: null }
    }),
}))

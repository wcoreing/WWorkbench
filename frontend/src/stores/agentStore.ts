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
      const turnSkills = s.pendingTurnSkillIds.length ? [...s.pendingTurnSkillIds] : undefined
      return {
        streamingLineId: null,
        pendingTurnSkillIds: [],
        lines: s.lines.map((ln) =>
          ln.id === sid
            ? {
                ...ln,
                content: fullContent || ln.content,
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
      const text = line?.content.trim() ?? ''
      // 空内容或「继续等待」类空转旁白丢弃；有实质正文（报表等）保留为助手气泡
      if (!text || isTransientToolNarration(text)) {
        return {
          streamingLineId: null,
          lines: s.lines.filter((ln) => ln.id !== sid),
        }
      }
      return { streamingLineId: null }
    }),
}))

/** 工具调用间隙的空转旁白（无实质内容，可丢弃）。 */
function isTransientToolNarration(text: string): boolean {
  const t = text.trim()
  if (t.length > 80) return false
  if (/^继续等待|^持续(下载|推进)|^等待(完成|中)|^稍等|^请稍候/m.test(t)) return true
  if (t.length <= 40 && /等待|下载中|推进中/.test(t) && !/[|`#*]|表|报表|统计|SELECT/i.test(t)) {
    return true
  }
  return false
}

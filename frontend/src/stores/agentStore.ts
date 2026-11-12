import { create } from 'zustand'
import type { AgentOfferChoicesEvent } from '../api/agentEvents'
import type { AgentMention } from '../features/agent/agentMention'
import type { AgentPanelView } from '../features/agent/agentTypes'
import { loadChatMode, persistChatMode, type AgentChatMode } from '../features/agent/agentChatMode'

const STORAGE_OPEN = 'agent_panel_open'
const STORAGE_THREAD = 'agent_thread_id'

export type AgentSessionPhase =
  | 'idle'
  | 'streaming'
  | 'tools'
  | 'needs_choice'
  | 'error'

export interface AgentChatLine {
  id: string
  role: 'user' | 'assistant' | 'system'
  /** 工具调用之前的正文（时间线前段） */
  content: string
  mentions?: AgentMention[]
  skillIds?: string[]
  images?: { mime: string; data: string }[]
  /** history_message.seq；用于 thread#seq 查日志 */
  seq?: number
  /** 本条 assistant 下挂的工具（可折叠，对齐 Cursor） */
  tools?: AgentToolStep[]
  /** 工具调用之后续写的正文（时间线后段） */
  contentAfter?: string
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
  /** 后端 tool call id；用于 finish 时精确匹配 */
  callId?: string
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
  /** 网络流已结束，UI 仍在匀速揭示的行（避免整段闪现）。 */
  revealingLineId: string | null
  /** 流式正文缓冲：与 lines 分离，避免每 token 复制整表 messages。 */
  streamingDraft: string
  draftInput: string
  draftMentions: AgentMention[]
  draftSkillIds: string[]
  /** 本轮 draft 是否带了 message（无则输入栏保留原文）。 */
  draftHasMessage: boolean
  draftTick: number
  /** 草稿就绪后由输入栏自动发送（舞台按钮接管侧栏 Agent）。 */
  pendingAutoSend: boolean
  threadMentions: AgentMention[]
  threadSkillIds: string[]
  pendingTurnSkillIds: string[]
  chatMode: AgentChatMode
  sessionPhase: AgentSessionPhase
  pendingChoice: AgentOfferChoicesEvent | null
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
  clearRevealing: (lineId?: string) => void
  applyDraft: (payload: {
    message?: string
    mentions: AgentMention[]
    skillIds?: string[]
    autoSend?: boolean
  }) => void
  /** 消费一次自动发送标记；已消费返回 true。 */
  takePendingAutoSend: () => boolean
  pushToolStep: (tool: string, argsPreview?: string, callId?: string) => string
  finishToolStep: (
    match: { callId?: string; tool: string },
    status?: AgentToolStep['status'],
    summary?: string,
  ) => void
  setThreadMentions: (mentions: AgentMention[]) => void
  setThreadSkillIds: (ids: string[]) => void
  setPendingTurnSkillIds: (ids: string[]) => void
  setChatMode: (mode: AgentChatMode) => void
  setSessionPhase: (phase: AgentSessionPhase) => void
  setPendingChoice: (pending: AgentOfferChoicesEvent | null) => void
  clearSessionWait: () => void
  /** 统计当前线程仍在 running 的工具数。 */
  countRunningTools: () => number
}

/** 流式 delta 合并到下一帧再写入，避免每 token 同步打爆 React。 */
let streamDeltaBuf = ''
let streamDeltaRaf = 0

function flushStreamDeltaBuf() {
  if (streamDeltaRaf) {
    cancelAnimationFrame(streamDeltaRaf)
    streamDeltaRaf = 0
  }
  const chunk = streamDeltaBuf
  streamDeltaBuf = ''
  if (!chunk) return
  useAgentStore.setState((s) => {
    if (!s.streamingLineId) return s
    return {
      streamingDraft: s.streamingDraft + chunk,
      sessionPhase: s.pendingChoice ? 'needs_choice' : 'streaming',
    }
  })
}

/** useAgentStore AI 侧栏与对话状态（收起不丢会话）。 */
export const useAgentStore = create<AgentStore>((set, get) => ({
  panelOpen: loadAgentPanelOpen(),
  view: 'chat',
  threadId: loadAgentThreadId(),
  lines: [],
  streamingLineId: null,
  revealingLineId: null,
  streamingDraft: '',
  draftInput: '',
  draftMentions: [],
  draftSkillIds: [],
  draftHasMessage: false,
  draftTick: 0,
  pendingAutoSend: false,
  threadMentions: [],
  threadSkillIds: [],
  pendingTurnSkillIds: [],
  chatMode: loadChatMode(),
  sessionPhase: 'idle',
  pendingChoice: null,
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
      revealingLineId: null,
      streamingDraft: '',
      view: 'chat',
      threadMentions: [],
      threadSkillIds: [],
      pendingTurnSkillIds: [],
      sessionPhase: 'idle',
      pendingChoice: null,
    })
  },
  setThreadMentions: (threadMentions) => set({ threadMentions }),
  setThreadSkillIds: (threadSkillIds) => set({ threadSkillIds }),
  setPendingTurnSkillIds: (pendingTurnSkillIds) => set({ pendingTurnSkillIds }),
  setChatMode: (chatMode) => {
    persistChatMode(chatMode)
    set({ chatMode })
  },
  setSessionPhase: (sessionPhase) => set({ sessionPhase }),
  setPendingChoice: (pendingChoice) =>
    set({
      pendingChoice,
      sessionPhase: pendingChoice
        ? 'needs_choice'
        : get().streamingLineId
          ? 'streaming'
          : get().countRunningTools() > 0
            ? 'tools'
            : 'idle',
    }),
  clearSessionWait: () =>
    set({
      pendingChoice: null,
      sessionPhase: 'idle',
    }),
  countRunningTools: () => {
    let n = 0
    for (const ln of get().lines) {
      for (const step of ln.tools || []) {
        if (step.status === 'running') n += 1
      }
    }
    return n
  },
  applyDraft: (payload) =>
    set((s) => ({
      panelOpen: true,
      view: 'chat',
      draftInput: payload.message ?? s.draftInput,
      draftHasMessage: payload.message !== undefined,
      // 本批新增 @；由输入栏与已有 chips 合并，避免覆盖 / 复活已移除项。
      draftMentions: payload.mentions,
      draftSkillIds: payload.skillIds ?? [],
      pendingAutoSend: Boolean(payload.autoSend && (payload.message ?? '').trim()),
      draftTick: s.draftTick + 1,
    })),
  takePendingAutoSend: () => {
    const s = get()
    if (!s.pendingAutoSend) return false
    set({ pendingAutoSend: false })
    return true
  },
  pushToolStep: (tool, argsPreview, callId) => {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => {
      let lines = [...s.lines]
      let streamingLineId = s.streamingLineId
      let streamingDraft = s.streamingDraft
      if (streamingLineId) {
        const cur = lines.find((ln) => ln.id === streamingLineId)
        const alreadyTools = !!(cur?.tools && cur.tools.length)
        if (streamingDraft.trim()) {
          lines = lines.map((ln) =>
            ln.id === streamingLineId
              ? alreadyTools
                ? { ...ln, contentAfter: streamingDraft }
                : { ...ln, content: streamingDraft }
              : ln,
          )
        } else if (
          !cur?.content.trim() &&
          !cur?.contentAfter?.trim() &&
          !alreadyTools
        ) {
          lines = lines.filter((ln) => ln.id !== streamingLineId)
        }
        streamingLineId = null
        streamingDraft = ''
      }
      const step: AgentToolStep = {
        id,
        tool,
        callId: callId || undefined,
        status: 'running',
        argsPreview,
      }
      let idx = -1
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].role === 'assistant') {
          idx = i
          break
        }
      }
      // 上一段已有工具后续写：再调工具则新开一条，按历史先后排列，不挤进旧块
      if (idx >= 0 && (lines[idx].contentAfter || '').trim()) {
        const nid = nextAgentLineId()
        lines.push({ id: nid, role: 'assistant', content: '', tools: [step] })
      } else if (idx < 0) {
        const nid = nextAgentLineId()
        lines.push({ id: nid, role: 'assistant', content: '', tools: [step] })
      } else {
        const ln = lines[idx]
        lines[idx] = {
          ...ln,
          tools: [...(ln.tools || []), step],
        }
      }
      return {
        lines,
        streamingLineId,
        streamingDraft,
        revealingLineId: null,
        sessionPhase: s.pendingChoice ? 'needs_choice' : 'tools',
      }
    })
    return id
  },
  finishToolStep: (match, status = 'ok', summary) =>
    set((s) => {
      const lines = s.lines.map((ln) => ({ ...ln, tools: ln.tools ? [...ln.tools] : undefined }))
      const callId = match.callId?.trim()
      const openStatuses = new Set(['running'])
      outer: for (let i = lines.length - 1; i >= 0; i--) {
        const tools = lines[i].tools
        if (!tools?.length) continue
        let ti = -1
        if (callId) {
          ti = tools.findIndex(
            (step) =>
              openStatuses.has(step.status) &&
              (step.callId === callId || step.id === callId),
          )
        }
        if (ti < 0) {
          ti = tools.findIndex(
            (step) => step.tool === match.tool && openStatuses.has(step.status),
          )
        }
        if (ti < 0) continue
        tools[ti] = {
          ...tools[ti],
          status,
          summary,
          callId: callId || tools[ti].callId,
        }
        lines[i] = { ...lines[i], tools }
        break outer
      }
      let running = 0
      for (const ln of lines) {
        for (const step of ln.tools || []) {
          if (step.status === 'running') running += 1
        }
      }
      const phase: AgentSessionPhase = s.pendingChoice
        ? 'needs_choice'
        : s.streamingLineId
          ? 'streaming'
          : running > 0
            ? 'tools'
            : s.sessionPhase === 'error'
              ? 'error'
              : 'idle'
      return { lines, sessionPhase: phase }
    }),
  beginStreaming: () => {
    set((s) => {
      // 同一轮（tools 之后继续吐字）复用最近一条 assistant，避免多条 id
      let idx = -1
      for (let i = s.lines.length - 1; i >= 0; i--) {
        if (s.lines[i].role === 'assistant') {
          idx = i
          break
        }
        if (s.lines[i].role === 'user') break
      }
      if (idx >= 0) {
        const ln = s.lines[idx]
        const hasTools = !!(ln.tools && ln.tools.length)
        // 已有工具：续写进 contentAfter，保持时间线「文 → 工具 → 文」
        return {
          streamingLineId: ln.id,
          streamingDraft: hasTools ? ln.contentAfter || '' : ln.content || '',
          sessionPhase: s.pendingChoice ? 'needs_choice' : 'streaming',
        }
      }
      const id = nextAgentLineId()
      return {
        streamingLineId: id,
        streamingDraft: '',
        sessionPhase: s.pendingChoice ? 'needs_choice' : 'streaming',
        lines: [...s.lines, { id, role: 'assistant', content: '', tools: [] }],
      }
    })
  },
  appendStreamDelta: (delta) => {
    if (!delta || !get().streamingLineId) return
    streamDeltaBuf += delta
    if (streamDeltaRaf) return
    streamDeltaRaf = requestAnimationFrame(() => {
      streamDeltaRaf = 0
      flushStreamDeltaBuf()
    })
  },
  finishStreaming: (fullContent, seq) => {
    flushStreamDeltaBuf()
    set((s) => {
      const sid = s.streamingLineId
      if (!sid) return { streamingLineId: null, streamingDraft: '' }
      const turnSkills = s.pendingTurnSkillIds.length ? [...s.pendingTurnSkillIds] : undefined
      let running = 0
      for (const ln of s.lines) {
        for (const step of ln.tools || []) {
          if (step.status === 'running') running += 1
        }
      }
      return {
        streamingLineId: null,
        revealingLineId: sid,
        streamingDraft: '',
        pendingTurnSkillIds: [],
        sessionPhase: s.pendingChoice ? 'needs_choice' : running > 0 ? 'tools' : 'idle',
        lines: s.lines.map((ln) => {
          if (ln.id !== sid) return ln
          const hasTools = !!(ln.tools && ln.tools.length)
          const prev = hasTools ? ln.contentAfter || '' : ln.content || ''
          const incoming = (fullContent || s.streamingDraft || '').trimEnd()
          let next = prev
          if (!prev) next = incoming
          else if (!incoming) next = prev
          else if (incoming.startsWith(prev) || incoming.includes(prev)) {
            next = incoming.length >= prev.length ? incoming : prev
          } else if (prev.includes(incoming)) {
            next = prev
          } else {
            next = `${prev.replace(/\s+$/, '')}\n\n${incoming}`
          }
          return {
            ...ln,
            ...(hasTools ? { contentAfter: next } : { content: next }),
            seq: ln.seq && ln.seq > 0 ? ln.seq : seq,
            skillIds: turnSkills ?? ln.skillIds,
          }
        }),
      }
    })
  },
  clearRevealing: (lineId) =>
    set((s) => {
      if (lineId && s.revealingLineId && s.revealingLineId !== lineId) return s
      return { revealingLineId: null }
    }),
  cancelStreaming: () => {
    flushStreamDeltaBuf()
    set((s) => {
      const sid = s.streamingLineId
      // 无进行中的流式行时不要动 revealingLineId，否则 onDone 会掐掉收尾打字机
      if (!sid) return s
      const line = s.lines.find((ln) => ln.id === sid)
      const hasTools = !!(line?.tools && line.tools.length)
      const sealed = hasTools ? line?.contentAfter?.trim() : line?.content?.trim()
      const draft = s.streamingDraft.trim()
      const text = sealed || draft
      if (!text && !hasTools) {
        return {
          streamingLineId: null,
          streamingDraft: '',
          lines: s.lines.filter((ln) => ln.id !== sid),
        }
      }
      if (!draft || sealed) {
        return { streamingLineId: null, streamingDraft: '' }
      }
      return {
        streamingLineId: null,
        streamingDraft: '',
        lines: s.lines.map((ln) =>
          ln.id === sid
            ? hasTools
              ? { ...ln, contentAfter: s.streamingDraft }
              : { ...ln, content: s.streamingDraft }
            : ln,
        ),
      }
    })
  },
}))

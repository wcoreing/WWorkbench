import type { AgentChatLine } from '../../stores/agentStore'

/** 无正文/后续写的纯工具 assistant 回合（命令框可与相邻回合合并展示）。 */
export function isToolOnlyAssistant(line: AgentChatLine): boolean {
  return (
    line.role === 'assistant' &&
    !(line.content || '').trim() &&
    !(line.contentAfter || '').trim() &&
    (line.tools?.length ?? 0) > 0 &&
    !(line.images?.length) &&
    !(line.skillIds?.length)
  )
}

/**
 * 合并相邻纯工具回合，使命令框走同一 `.agent-turn-tools` gap，
 * 避免被 messages-inner 回合间距 + 工具块外边距撑开。
 */
export function coalesceToolOnlyLines(lines: AgentChatLine[]): AgentChatLine[] {
  const out: AgentChatLine[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    if (prev && isToolOnlyAssistant(prev) && isToolOnlyAssistant(line)) {
      out[out.length - 1] = {
        ...prev,
        tools: [...(prev.tools || []), ...(line.tools || [])],
      }
      continue
    }
    out.push(line)
  }
  return out
}

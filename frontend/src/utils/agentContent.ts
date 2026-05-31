/** AgentContentBlock 助手消息内容块。 */
export type AgentContentBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'echarts'; option: Record<string, unknown>; error?: string }

const ECHARTS_RE = /```echarts\s*\n([\s\S]*?)```/gi

/** parseAgentBlocks 拆分 Markdown 与 echarts 代码块。 */
export function parseAgentBlocks(source: string): AgentContentBlock[] {
  const blocks: AgentContentBlock[] = []
  let last = 0
  let m: RegExpExecArray | null
  ECHARTS_RE.lastIndex = 0
  while ((m = ECHARTS_RE.exec(source)) !== null) {
    if (m.index > last) {
      blocks.push({ kind: 'markdown', text: source.slice(last, m.index) })
    }
    const raw = m[1].trim()
    try {
      const option = JSON.parse(raw) as Record<string, unknown>
      blocks.push({ kind: 'echarts', option })
    } catch {
      blocks.push({ kind: 'echarts', option: {}, error: 'ECharts JSON 无效' })
    }
    last = m.index + m[0].length
  }
  if (last < source.length) {
    blocks.push({ kind: 'markdown', text: source.slice(last) })
  }
  if (blocks.length === 0) {
    blocks.push({ kind: 'markdown', text: source })
  }
  return blocks
}

/** hasEchartsBlock 是否包含 echarts 块。 */
export function hasEchartsBlock(source: string): boolean {
  return /```echarts/i.test(source)
}

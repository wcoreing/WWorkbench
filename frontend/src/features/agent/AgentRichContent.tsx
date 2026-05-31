import { useMemo } from 'react'
import { markdownToHtml } from '../../utils/markdown'
import { parseAgentBlocks } from '../../utils/agentContent'
import { AgentEChart } from './AgentEChart'

interface Props {
  content: string
}

/** AgentRichContent 渲染助手消息（Markdown + ECharts）。 */
export function AgentRichContent({ content }: Props) {
  const blocks = useMemo(() => parseAgentBlocks(content), [content])

  return (
    <div className="agent-rich">
      {blocks.map((block, i) => {
        if (block.kind === 'echarts') {
          return (
            <AgentEChart
              key={`chart-${i}`}
              option={block.option}
              error={block.error}
            />
          )
        }
        const html = markdownToHtml(block.text)
        if (!html.trim()) return null
        return (
          <div
            key={`md-${i}`}
            className="agent-md"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </div>
  )
}

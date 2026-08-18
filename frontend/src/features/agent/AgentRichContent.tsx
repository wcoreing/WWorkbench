import { useMemo, type MouseEvent } from 'react'
import { markdownToHtml } from '../../utils/markdown'
import { parseAgentBlocks } from '../../utils/agentContent'
import { AgentEChart } from './AgentEChart'
import { useI18n } from '../../i18n'

interface Props {
  content: string
}

/** AgentRichContent 渲染助手消息（Markdown + ECharts）。 */
export function AgentRichContent({ content }: Props) {
  const { t } = useI18n()
  const copyLabel = t('common.copy')
  const copiedLabel = t('common.copied')
  const blocks = useMemo(() => parseAgentBlocks(content), [content])

  const onClick = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('.md-code-copy')
    if (!(btn instanceof HTMLElement)) return
    const code = btn.parentElement?.querySelector('code')
    const text = code?.textContent ?? ''
    if (!text) return
    void navigator.clipboard.writeText(text).then(() => {
      btn.setAttribute('title', copiedLabel)
      btn.setAttribute('aria-label', copiedLabel)
      btn.classList.add('is-copied')
      window.setTimeout(() => {
        btn.setAttribute('title', copyLabel)
        btn.setAttribute('aria-label', copyLabel)
        btn.classList.remove('is-copied')
      }, 1200)
    })
  }

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
        const html = markdownToHtml(block.text, { copyLabel })
        if (!html.trim()) return null
        return (
          <div
            key={`md-${i}`}
            className="agent-md"
            onClick={onClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </div>
  )
}

import { useMemo, type MouseEvent } from 'react'
import { AgentEChart } from '../agent/AgentEChart'
import { useI18n } from '../../i18n'
import { parseAgentBlocks } from '../../utils/agentContent'
import { markdownToHtml } from '../../utils/markdown'

interface Props {
  content: string
}

/** MarkdownPreview Markdown 预览（含 ```echarts 报表图）。 */
export function MarkdownPreview({ content }: Props) {
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
    <article className="notebook-md-preview">
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
            className="notebook-md-segment"
            onClick={onClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </article>
  )
}

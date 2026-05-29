import { useMemo } from 'react'

/** escapeHtml 转义 HTML 特殊字符。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** renderInline 渲染行内 Markdown。 */
function renderInline(text: string): string {
  let s = escapeHtml(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return s
}

/** markdownToHtml 将常见 Markdown 转为 HTML（轻量预览）。 */
function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let listOpen = false

  const closeList = () => {
    if (listOpen) {
      out.push('</ul>')
      listOpen = false
    }
  }

  for (const raw of lines) {
    const line = raw

    if (line.startsWith('```')) {
      closeList()
      if (!inCode) {
        inCode = true
        codeBuf = []
      } else {
        inCode = false
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
      }
      continue
    }

    if (inCode) {
      codeBuf.push(line)
      continue
    }

    if (/^#{1,6}\s/.test(line)) {
      closeList()
      const level = line.match(/^#+/)?.[0].length ?? 1
      const text = line.replace(/^#+\s*/, '')
      out.push(`<h${Math.min(level, 6)}>${renderInline(text)}</h${Math.min(level, 6)}>`)
      continue
    }

    if (/^[-*]\s/.test(line)) {
      if (!listOpen) {
        out.push('<ul>')
        listOpen = true
      }
      out.push(`<li>${renderInline(line.replace(/^[-*]\s*/, ''))}</li>`)
      continue
    }

    if (/^\|.+\|$/.test(line.trim())) {
      closeList()
      const cells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue
      out.push(`<p class="md-table-row">${cells.map((c) => renderInline(c)).join(' · ')}</p>`)
      continue
    }

    if (!line.trim()) {
      closeList()
      out.push('<br />')
      continue
    }

    closeList()
    out.push(`<p>${renderInline(line)}</p>`)
  }

  closeList()
  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  return out.join('\n')
}

interface Props {
  content: string
}

/** MarkdownPreview Markdown 轻量预览。 */
export function MarkdownPreview({ content }: Props) {
  const html = useMemo(() => markdownToHtml(content), [content])
  return <article className="notebook-md-preview" dangerouslySetInnerHTML={{ __html: html }} />
}

import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

/** escapeHtml 转义 HTML 特殊字符。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** enhanceMarkdownHtml 为表格与提示块补充样式类。 */
function enhanceMarkdownHtml(html: string): string {
  let out = html.replace(/<table>/g, '<table class="md-table">')
  out = out.replace(
    /<blockquote>\s*<p>(✅[\s\S]*?)<\/p>\s*<\/blockquote>/g,
    '<blockquote class="md-callout md-callout-ok"><p>$1</p></blockquote>',
  )
  out = out.replace(
    /<blockquote>\s*<p>(⚠️|⚠)[\s\S]*?<\/p>\s*<\/blockquote>/g,
    (m) => m.replace('<blockquote>', '<blockquote class="md-callout md-callout-warn">'),
  )
  return out
}

/** markdownToHtml 将 GFM Markdown 转为安全 HTML。 */
export function markdownToHtml(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return ''
  const raw = marked.parse(trimmed, { async: false }) as string
  const enhanced = enhanceMarkdownHtml(raw)
  return DOMPurify.sanitize(enhanced, {
    ADD_ATTR: ['target', 'class'],
  })
}

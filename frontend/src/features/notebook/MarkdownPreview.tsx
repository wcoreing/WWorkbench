import { useMemo } from 'react'
import { markdownToHtml } from '../../utils/markdown'

interface Props {
  content: string
}

/** MarkdownPreview Markdown 轻量预览。 */
export function MarkdownPreview({ content }: Props) {
  const html = useMemo(() => markdownToHtml(content), [content])
  return <article className="notebook-md-preview" dangerouslySetInnerHTML={{ __html: html }} />
}

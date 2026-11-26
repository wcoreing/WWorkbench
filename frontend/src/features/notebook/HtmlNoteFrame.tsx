import { useEffect, useMemo, useRef } from 'react'
import { rewriteDerivedAssetRefs, withDerivedSourceLink } from './derivedView'

/** HtmlNoteFrame 在隔离框里显示 HTML 页面。只有点中约定的源笔记才会回到文档。 */
export function HtmlNoteFrame({
  title,
  html,
  pageNoteId,
  sourceId,
  onOpenSource,
}: {
  title: string
  html: string
  pageNoteId?: string
  sourceId?: string
  onOpenSource?: (id: string) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const source = (sourceId || '').trim()
  const doc = useMemo(
    () => withDerivedSourceLink(rewriteDerivedAssetRefs(html, pageNoteId || ''), source),
    [html, source, pageNoteId],
  )

  useEffect(() => {
    if (!source || !onOpenSource) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { type?: string; id?: string } | null
      if (!data || data.type !== 'wwb-open-note' || data.id !== source) return
      onOpenSource(source)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [source, onOpenSource])

  return (
    <iframe
      ref={frameRef}
      className="notebook-html-frame"
      title={title || 'HTML'}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
    />
  )
}

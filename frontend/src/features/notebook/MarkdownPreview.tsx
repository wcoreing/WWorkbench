import { useMemo, type MouseEvent } from 'react'
import DOMPurify from 'dompurify'
import { api } from '../../api/client'
import { AgentEChart } from '../agent/AgentEChart'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { parseAgentBlocks } from '../../utils/agentContent'
import { markdownToHtml } from '../../utils/markdown'
import { parseNotebookAssetHref, rewriteNotebookAssetLinks, withPreviewAssetDeletes } from './notebookAssetLinks'

interface Props {
  content: string
  /** noteId 用于把相对 assets/ 链接映射到 AssetServer。 */
  noteId?: string
  /** 传入后，预览里的笔记附件后面出现删除。 */
  onForgetAsset?: (file: string) => void
}

type ListedAsset = { id: string; name: string; url: string }

/** MarkdownPreview Markdown 预览（含 ```echarts 报表图）。 */
export function MarkdownPreview({ content, noteId, onForgetAsset }: Props) {
  const { t } = useI18n()
  const copyLabel = t('common.copy')
  const copiedLabel = t('common.copied')
  const deleteLabel = t('common.delete')
  const resolved = useMemo(() => rewriteNotebookAssetLinks(content, noteId || ''), [content, noteId])
  const blocks = useMemo(() => parseAgentBlocks(resolved), [resolved])

  const onClick = (e: MouseEvent) => {
    const del = (e.target as HTMLElement).closest('.md-asset-delete')
    if (del instanceof HTMLElement) {
      e.preventDefault()
      e.stopPropagation()
      const file = del.getAttribute('data-asset-file') || ''
      if (file && noteId && onForgetAsset) void removePreviewAsset(noteId, file, onForgetAsset, t('notebook.resourceDeleted'))
      return
    }
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
        const html = previewHtml(markdownToHtml(block.text, { copyLabel }), Boolean(onForgetAsset), deleteLabel)
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

function previewHtml(html: string, withDelete: boolean, deleteLabel: string): string {
  if (!withDelete || !html.trim()) return html
  return DOMPurify.sanitize(withPreviewAssetDeletes(html, deleteLabel), {
    ADD_TAGS: ['button'],
    ADD_ATTR: ['target', 'class', 'type', 'title', 'aria-label', 'data-asset-file'],
  })
}

async function removePreviewAsset(
  noteId: string,
  file: string,
  forget: (file: string) => void,
  okText: string,
) {
  try {
    const list = (await api.listNotebookResources(noteId)) as ListedAsset[]
    const hit = list.find((asset) => assetFileName(asset) === file || asset.name === file)
    if (hit) await api.deleteNotebookResource(hit.id)
    forget(file)
    notify.success(okText)
  } catch (err) {
    notify.error((err as Error).message)
  }
}

function assetFileName(asset: ListedAsset): string {
  const parsed = parseNotebookAssetHref(asset.url || '')
  return parsed?.file || asset.name
}

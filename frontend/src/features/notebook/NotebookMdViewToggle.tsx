import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'

export type NotebookMdViewMode = 'source' | 'split' | 'preview'

const MODES: NotebookMdViewMode[] = ['source', 'split', 'preview']

type Props = {
  mode: NotebookMdViewMode
  onChange: (mode: NotebookMdViewMode) => void
}

/** NotebookMdViewToggle Markdown 视图分段：原文件 / 双屏 / 仅预览。 */
export function NotebookMdViewToggle({ mode, onChange }: Props) {
  const { t } = useI18n()

  const labels: Record<NotebookMdViewMode, string> = {
    source: t('notebook.viewSource'),
    split: t('notebook.viewSplit'),
    preview: t('notebook.viewPreviewOnly'),
  }

  return (
    <div className="notebook-view-seg" role="radiogroup" aria-label={t('notebook.viewMode')}>
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={`notebook-view-seg-btn${mode === m ? ' is-active' : ''}`}
          title={labels[m]}
          {...pressProps(() => onChange(m))}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  )
}

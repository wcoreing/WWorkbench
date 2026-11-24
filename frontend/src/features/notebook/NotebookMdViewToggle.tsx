import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'

export type NotebookMdViewMode = 'page' | 'source' | 'split' | 'preview'

const MODES: NotebookMdViewMode[] = ['source', 'split', 'preview']

type Props = {
  mode: NotebookMdViewMode
  onChange: (mode: NotebookMdViewMode) => void
  showPage?: boolean
}

/** NotebookMdViewToggle Markdown 视图分段。有派生页面时，「页面」与编辑、双屏、预览同一组。 */
export function NotebookMdViewToggle({ mode, onChange, showPage }: Props) {
  const { t } = useI18n()
  const modes: NotebookMdViewMode[] = showPage ? ['page', ...MODES] : MODES

  const labels: Record<NotebookMdViewMode, string> = {
    page: t('notebook.derivedOpen'),
    source: t('notebook.viewSource'),
    split: t('notebook.viewSplit'),
    preview: t('notebook.viewPreviewOnly'),
  }

  return (
    <div className="notebook-view-seg" role="radiogroup" aria-label={t('notebook.viewMode')}>
      {modes.map((m) => (
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

import { useEffect, useRef, useState } from 'react'
import { pressProps, useDismissOverlays } from '../../components/compat'
import { useI18n } from '../../i18n'

export type NotebookMdViewMode = 'source' | 'split' | 'preview'

const MODES: NotebookMdViewMode[] = ['source', 'split', 'preview']

type Props = {
  mode: NotebookMdViewMode
  onChange: (mode: NotebookMdViewMode) => void
}

/** NotebookMdViewToggle Markdown 视图下拉：原文件 / 双屏 / 仅预览。 */
export function NotebookMdViewToggle({ mode, onChange }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useDismissOverlays(() => setOpen(false))

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const labels: Record<NotebookMdViewMode, string> = {
    source: t('notebook.viewSource'),
    split: t('notebook.viewSplit'),
    preview: t('notebook.viewPreviewOnly'),
  }

  return (
    <div className="notebook-view-menu" ref={rootRef}>
      <button
        type="button"
        className="wn-btn wn-btn-sm wn-btn-tool notebook-view-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('notebook.viewMode')}
        {...pressProps(() => setOpen((v) => !v))}
      >
        <span className="notebook-view-trigger-label">{labels[mode]}</span>
        <span className="notebook-view-trigger-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="notebook-meta-dropdown" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m}
              className={`notebook-meta-dropdown-item${mode === m ? ' active' : ''}`}
              {...pressProps(() => {
                onChange(m)
                setOpen(false)
              })}
            >
              {labels[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

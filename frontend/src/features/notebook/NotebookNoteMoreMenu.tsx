import { useEffect, useRef, useState } from 'react'
import { IconUpload } from '../../components/Icons'
import { pressProps, useDismissOverlays } from '../../components/compat'
import { useI18n } from '../../i18n'

type Props = {
  hasConnection: boolean
  onInsertImage: () => void
  onInsertAttachment: () => void
  onInsertTemplate: () => void
  onDuplicate: () => void
  onExport: () => void
  onRevealInFinder: () => void
  onOpenDatabase: () => void
  onDelete: () => void
}

/** NotebookNoteMoreMenu 笔记次要操作收纳，避免顶栏按钮墙。 */
export function NotebookNoteMoreMenu({
  hasConnection,
  onInsertImage,
  onInsertAttachment,
  onInsertTemplate,
  onDuplicate,
  onExport,
  onRevealInFinder,
  onOpenDatabase,
  onDelete,
}: Props) {
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

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <div className="notebook-more-menu" ref={rootRef}>
      <button
        type="button"
        className={`notebook-meta-icon-btn${open ? ' is-open' : ''}`}
        title={t('notebook.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        {...pressProps(() => setOpen((v) => !v))}
      >
        <span className="notebook-more-glyph" aria-hidden>
          ⋯
        </span>
      </button>
      {open && (
        <div className="notebook-more-dropdown" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="notebook-more-dropdown-head">{t('notebook.moreActions')}</div>
          <button type="button" className="notebook-more-item" {...pressProps(() => run(onInsertImage))}>
            {t('notebook.insertImage')}
          </button>
          <button type="button" className="notebook-more-item" {...pressProps(() => run(onInsertAttachment))}>
            <IconUpload size={12} /> {t('notebook.insertAttachment')}
          </button>
          <button type="button" className="notebook-more-item" {...pressProps(() => run(onInsertTemplate))}>
            {t('notebook.insertTemplate')}
          </button>
          <div className="notebook-more-sep" />
          <button type="button" className="notebook-more-item" {...pressProps(() => run(onDuplicate))}>
            {t('notebook.duplicate')}
          </button>
          <button type="button" className="notebook-more-item" {...pressProps(() => run(onExport))}>
            {t('notebook.export')}
          </button>
          <button type="button" className="notebook-more-item" {...pressProps(() => run(onRevealInFinder))}>
            {t('notebook.revealInFinder')}
          </button>
          {hasConnection && (
            <>
              <div className="notebook-more-sep" />
              <button type="button" className="notebook-more-item" {...pressProps(() => run(onOpenDatabase))}>
                {t('notebook.openAndRun')}
              </button>
            </>
          )}
          <div className="notebook-more-sep" />
          <button
            type="button"
            className="notebook-more-item is-danger"
            {...pressProps(() => run(onDelete))}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

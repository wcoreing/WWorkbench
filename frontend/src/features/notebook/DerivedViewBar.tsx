import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { derivedSourceStale, linkedSourceNoteId, parseDerivedView, type FileStamp } from './derivedView'

/** DerivedViewBar 页面上方的来源、技能，以及源是否已往前走。 */
export function DerivedViewBar({
  noteId,
  html,
  onOpen,
}: {
  noteId: string
  html: string
  onOpen: (id: string) => void
}) {
  const { t } = useI18n()
  const view = parseDerivedView(html)
  const source = linkedSourceNoteId(noteId, html)
  const [stamp, setStamp] = useState<FileStamp | null>(null)

  useEffect(() => {
    if (!source) {
      setStamp(null)
      return
    }
    let cancelled = false
    api
      .noteFileRevision(source)
      .then((rev) => {
        if (!cancelled) {
          setStamp({
            enabled: Boolean(rev.enabled),
            short: rev.short || '',
            dirty: Boolean(rev.dirty),
          })
        }
      })
      .catch(() => {
        if (!cancelled) setStamp(null)
      })
    return () => {
      cancelled = true
    }
  }, [source])

  if (!source && !view.skill) return null
  const stale = derivedSourceStale(view.sourceRev, stamp)

  return (
    <div className="notebook-derived-bar">
      {source ? (
        <button
          type="button"
          className="wn-btn wn-btn-xs wn-btn-ghost"
          title={source}
          {...pressProps(() => onOpen(source))}
        >
          {t('notebook.derivedSource')} {source}
        </button>
      ) : null}
      {view.skill ? <span className="notebook-derived-skill">{view.skill}</span> : null}
      {stale ? <span className="notebook-derived-stale">{t('notebook.derivedStale')}</span> : null}
    </div>
  )
}

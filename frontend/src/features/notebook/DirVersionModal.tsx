import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { backdropDismissProps, pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { askConfirm } from '../../utils/askConfirm'
import { basenameRel } from './notebookPathOps'
import '../../components/ui.css'

export type DirVersionItem = {
  hash: string
  short: string
  subject: string
  when: string
}

type Props = {
  open: boolean
  dirRel: string
  onClose: () => void
  onRestored?: () => void
}

function formatWhen(when: string): string {
  const s = (when || '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function subjectLabel(subject: string): string {
  const s = (subject || '').trim()
  if (!s) return '—'
  if (s.startsWith('update_skill:')) return s.slice('update_skill:'.length).trim() || s
  if (s.startsWith('restore:')) return `↩ ${s.slice('restore:'.length).trim() || s}`
  if (s.startsWith('save_workflow:')) return s.slice('save_workflow:'.length).trim() || s
  if (s === 'create_version' || s === 'ui_pin' || s === 'ui_create_version') return '手动创建'
  if (s.startsWith('create_version')) return s.slice('create_version'.length).replace(/^[:：]\s*/, '') || '手动创建'
  if (s.startsWith('ui_pin')) return s.slice('ui_pin'.length).replace(/^[:：]\s*/, '') || '手动创建'
  if (s.startsWith('pin:')) return s.slice('pin:'.length).trim() || s
  return s
}

/** DirVersionModal 目录版本历史。 */
export function DirVersionModal({ open, dirRel, onClose, onRestored }: Props) {
  const { t } = useI18n()
  const [versions, setVersions] = useState<DirVersionItem[]>([])
  const [enabled, setEnabled] = useState(false)
  const [head, setHead] = useState('')
  const [working, setWorking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justCreated, setJustCreated] = useState('')

  const refresh = useCallback(async () => {
    const dir = dirRel.trim()
    if (!dir) {
      setVersions([])
      setEnabled(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      const st = await api.listDirVersions(dir, 48)
      setEnabled(Boolean(st.enabled))
      setVersions(Array.isArray(st.versions) ? st.versions : [])
      setHead((st.head || '').trim())
      setWorking(Boolean(st.working))
    } catch (e) {
      setError((e as Error).message)
      setVersions([])
      setEnabled(false)
    } finally {
      setBusy(false)
    }
  }, [dirRel])

  useEffect(() => {
    if (!open) {
      setJustCreated('')
      setError('')
      return
    }
    void refresh()
  }, [open, refresh])

  if (!open) return null

  const folderName = basenameRel(dirRel) || dirRel

  const createVersion = async () => {
    const dir = dirRel.trim()
    if (!dir) return
    setBusy(true)
    setError('')
    try {
      const res = await api.pinDirVersion(dir, t('notebook.dirVersionCreateMessage'))
      const short = (res.version?.short || res.version?.hash?.slice(0, 7) || '').trim()
      const hash = (res.version?.hash || '').trim()
      await refresh()
      setJustCreated(hash)
      notify.success(
        short
          ? t('notebook.dirVersionCreatedShort', { short, name: folderName })
          : t('notebook.dirVersionCreated', { dir: folderName }),
        { detail: short || undefined },
      )
      onRestored?.()
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (v: DirVersionItem) => {
    const dir = dirRel.trim()
    if (!dir || !v.hash) return
    const ok = await askConfirm({
      title: t('notebook.dirVersionRestoreTitle'),
      message: t('notebook.dirVersionRestoreMsg', {
        short: v.short || v.hash.slice(0, 7),
        subject: subjectLabel(v.subject),
      }),
      confirmLabel: t('notebook.dirVersionRestore'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      await api.restoreDirVersion(
        dir,
        v.hash,
        t('notebook.dirVersionRestoreIntent', { short: v.short || v.hash.slice(0, 7) }),
      )
      await refresh()
      const short = v.short || v.hash.slice(0, 7)
      notify.success(t('notebook.dirVersionRestored', { short }), { detail: short })
      onRestored?.()
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wn-modal-backdrop" {...backdropDismissProps(onClose)}>
      <div
        className="wn-modal notebook-version-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="notebook-version-title"
      >
        <header className="wn-modal-header notebook-version-modal-header">
          <div className="notebook-version-modal-heading">
            <h2 id="notebook-version-title" className="wn-modal-title">
              {t('notebook.dirVersions')}
            </h2>
            <p className="notebook-version-modal-path" title={dirRel}>
              {folderName}
            </p>
          </div>
          <div className="notebook-version-modal-actions">
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-primary"
              disabled={busy}
              title={t('notebook.dirVersionCreateHint')}
              {...pressProps(() => void createVersion())}
            >
              {busy ? t('notebook.dirVersionCreating') : t('notebook.dirVersionCreate')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-sm wn-btn-ghost"
              disabled={busy}
              {...pressProps(() => void refresh())}
            >
              {t('common.refresh')}
            </button>
          </div>
        </header>

        <div className="wn-modal-body notebook-version-modal-body">
          {error ? <div className="notebook-version-error">{error}</div> : null}
          {enabled && working ? <p className="notebook-version-hint">{t('notebook.dirVersionWorking')}</p> : null}
          {!enabled || versions.length === 0 ? (
            !busy ? <p className="notebook-version-empty">{t('notebook.dirVersionsEmpty')}</p> : null
          ) : (
            <ul className="notebook-version-list">
              {versions.map((v) => {
                const short = v.short || v.hash.slice(0, 7)
                const isHead = Boolean(head && (v.hash === head || head.startsWith(v.hash) || v.hash.startsWith(head)))
                const isNew = Boolean(
                  justCreated && (v.hash === justCreated || justCreated.startsWith(v.hash) || v.hash.startsWith(justCreated)),
                )
                return (
                  <li
                    key={v.hash}
                    className={`notebook-version-row${isHead ? ' is-head' : ''}${isNew ? ' is-new' : ''}`}
                  >
                    <code className="notebook-version-short" title={v.hash}>
                      {short}
                    </code>
                    <span className="notebook-version-subject" title={v.subject}>
                      {subjectLabel(v.subject)}
                    </span>
                    <span className="notebook-version-when">{formatWhen(v.when)}</span>
                    <span className="notebook-version-actions">
                      {isHead ? (
                        <span className="notebook-version-badge">{t('notebook.dirVersionHead')}</span>
                      ) : (
                        <button
                          type="button"
                          className="wn-btn wn-btn-xs wn-btn-ghost"
                          disabled={busy}
                          {...pressProps(() => void restore(v))}
                        >
                          {t('notebook.dirVersionRestore')}
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-ghost" {...pressProps(onClose)}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  )
}

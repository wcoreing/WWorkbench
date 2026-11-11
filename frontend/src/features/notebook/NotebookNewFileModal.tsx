import { useEffect, useMemo, useState } from 'react'
import type { NoteLanguage, ShellHost } from '../../api/types'
import { backdropDismissProps, pressProps, Select } from '../../components/compat'
import { useI18n } from '../../i18n'
import {
  NOTE_FILE_TYPE_PRESETS,
  extForLanguage,
} from './noteFileTypes'
import '../../components/ui.css'

export type NewFileDraft = {
  title: string
  language: NoteLanguage
  groupId: string
  sshHostId: string
}

type Props = {
  open: boolean
  groupId: string
  hosts: ShellHost[]
  defaultHostId?: string
  onClose: () => void
  onSubmit: (draft: NewFileDraft) => Promise<void>
}

/** NotebookNewFileModal 运维 IDE 新建文件：类型 + 绑定主机 + 文件名。 */
export function NotebookNewFileModal({
  open,
  groupId,
  hosts,
  defaultHostId = '',
  onClose,
  onSubmit,
}: Props) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<NoteLanguage>('shell')
  const [customLang, setCustomLang] = useState('')
  const [sshHostId, setSshHostId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const languageIsPreset = NOTE_FILE_TYPE_PRESETS.some((p) => p.id === language)
  const effectiveLanguage = !languageIsPreset || language === '__custom__'
    ? (customLang.trim() || 'custom')
    : language
  const ext = extForLanguage(effectiveLanguage)

  const typeOptions = useMemo(
    () => [
      ...NOTE_FILE_TYPE_PRESETS.map((p) => ({
        value: p.id,
        label: `${t(`notebook.${p.labelKey}` as 'notebook.langMarkdown')} (${p.ext})`,
      })),
      { value: '__custom__', label: t('notebook.langCustom') },
    ],
    [t],
  )

  const hostOptions = useMemo(
    () => [
      { value: '', label: t('notebook.noneLinked') },
      ...hosts.map((h) => ({
        value: h.id,
        label: h.kind === 'docker' ? `[Docker] ${h.name}` : h.name,
      })),
    ],
    [hosts, t],
  )

  useEffect(() => {
    if (!open) return
    setTitle('')
    setLanguage('shell')
    setCustomLang('')
    setSshHostId(defaultHostId || '')
    setError('')
  }, [open, groupId, defaultHostId])

  if (!open) return null

  const submit = async () => {
    const name = title.trim() || t('common.unnamed')
    if (!languageIsPreset && !customLang.trim()) {
      setError(t('notebook.errFileType'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        title: name,
        language: effectiveLanguage,
        groupId,
        sshHostId,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wn-modal-backdrop" {...backdropDismissProps(onClose)}>
      <div className="wn-modal wn-modal-compact" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="wn-modal-header">
          <h2 className="wn-modal-title">{t('notebook.newFileModal')}</h2>
        </header>
        <div className="wn-modal-body">
          <label className="wn-field">
            <span>{t('notebook.fileType')}</span>
            <Select
              className="wn-select"
              value={languageIsPreset ? language : '__custom__'}
              options={typeOptions}
              onChange={(v) => {
                if (v === '__custom__') {
                  setLanguage('__custom__')
                  return
                }
                setLanguage(v)
              }}
            />
          </label>
          {!languageIsPreset && (
            <label className="wn-field">
              <span>{t('notebook.langCustomId')}</span>
              <input
                className="wn-input"
                value={customLang}
                placeholder={t('notebook.langCustomPlaceholder')}
                onChange={(e) => setCustomLang(e.target.value)}
              />
            </label>
          )}
          <label className="wn-field">
            <span>{t('notebook.sshHost')}</span>
            <Select
              className="wn-select"
              value={sshHostId}
              options={hostOptions}
              onChange={(v) => setSshHostId(v)}
            />
          </label>
          <p className="notebook-new-file-hint">{t('notebook.newFileHostHint')}</p>
          <label className="wn-field">
            <span>{t('notebook.fileName')}</span>
            <div className="notebook-new-file-name">
              <input
                className="wn-input"
                value={title}
                autoFocus
                placeholder={t('common.unnamed')}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
              />
              <span className="notebook-new-file-ext">{ext}</span>
            </div>
          </label>
          {error && <div className="wn-form-error">{error}</div>}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-ghost" {...pressProps(onClose, { disabled: saving })}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-primary"
            disabled={saving}
            {...pressProps(() => void submit(), { disabled: saving })}
          >
            {t('notebook.createFile')}
          </button>
        </footer>
      </div>
    </div>
  )
}

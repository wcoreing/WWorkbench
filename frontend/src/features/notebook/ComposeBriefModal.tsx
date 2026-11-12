import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { backdropDismissProps, pressProps } from '../../components/compat'
import {
  BRIEF_TEMPLATES,
  briefTemplateById,
  type BriefTemplateId,
} from './composeBrief'
import '../../components/ui.css'

export type ComposeBriefDraft = {
  title: string
  templateId: BriefTemplateId
  requirement: string
}

type Props = {
  open: boolean
  sourceCount: number
  defaultTitle?: string
  onClose: () => void
  onSubmit: (draft: ComposeBriefDraft) => Promise<void>
}

/** ComposeBriefModal 选料后填写需求/模板，生成整理页。 */
export function ComposeBriefModal({
  open,
  sourceCount,
  defaultTitle = '',
  onClose,
  onSubmit,
}: Props) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState<BriefTemplateId>('handover')
  const [requirement, setRequirement] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const tpl = briefTemplateById('handover')
    setTitle(defaultTitle.trim() || t('notebook.briefDefaultTitle'))
    setTemplateId('handover')
    setRequirement(tpl.defaultRequirement)
    setError('')
  }, [open, defaultTitle, t])

  if (!open) return null

  const onTemplateChange = (id: BriefTemplateId) => {
    setTemplateId(id)
    const tpl = briefTemplateById(id)
    if (id !== 'custom') setRequirement(tpl.defaultRequirement)
    else if (!requirement.trim()) setRequirement('')
  }

  const submit = async () => {
    if (!title.trim()) {
      setError(t('notebook.briefErrTitle'))
      return
    }
    if (templateId === 'custom' && !requirement.trim()) {
      setError(t('notebook.briefErrRequirement'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        title: title.trim(),
        templateId,
        requirement: requirement.trim() || briefTemplateById(templateId).defaultRequirement,
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
      <div
        className="wn-modal wn-modal-compact notebook-brief-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="notebook-brief-title"
      >
        <header className="wn-modal-header">
          <h2 id="notebook-brief-title" className="wn-modal-title">
            {t('notebook.briefModalTitle')}
          </h2>
        </header>
        <div className="wn-modal-body">
          <p className="notebook-brief-hint">
            {t('notebook.briefSourceHint', { count: sourceCount })}
          </p>
          <label className="wn-field">
            <span>{t('notebook.briefTitle')}</span>
            <input
              className="wn-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label className="wn-field">
            <span>{t('notebook.briefTemplate')}</span>
            <select
              className="wn-input"
              value={templateId}
              onChange={(e) => onTemplateChange(e.target.value as BriefTemplateId)}
            >
              {BRIEF_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t(tpl.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="wn-field">
            <span>{t('notebook.briefRequirement')}</span>
            <textarea
              className="wn-input notebook-brief-requirement"
              rows={4}
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder={t('notebook.briefRequirementPh')}
            />
          </label>
          {error ? <p className="wn-field-error">{error}</p> : null}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" {...pressProps(onClose)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-primary"
            disabled={saving}
            {...pressProps(() => void submit(), { disabled: saving })}
          >
            {saving ? t('notebook.briefGenerating') : t('notebook.briefGenerate')}
          </button>
        </footer>
      </div>
    </div>
  )
}

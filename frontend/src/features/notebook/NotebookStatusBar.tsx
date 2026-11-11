import type { Note, NoteRole } from '../../api/types'
import { useI18n } from '../../i18n'
import { pressProps } from '../../components/compat'
import { extForLanguage } from './noteFileTypes'

type Props = {
  note: Note
  saveStatus: 'saved' | 'dirty' | 'saving'
  hostName?: string
  connectionName?: string
  onPickLanguage: () => void
  onRevealInFinder?: () => void
}

function roleLabel(t: (k: string) => string, role: NoteRole | string | undefined): string {
  switch (role) {
    case 'memory':
      return t('notebook.roleBadgeMemory')
    case 'skill':
      return t('notebook.roleBadgeSkill')
    default:
      return t('notebook.roleBadgeNote')
  }
}

function diskLabel(note: Note): string {
  return note.id || note.title
}

/** NotebookStatusBar IDE 底栏：文件类型 / 角色 / 磁盘路径 / 关联 / 保存态。 */
export function NotebookStatusBar({
  note,
  saveStatus,
  hostName,
  connectionName,
  onPickLanguage,
  onRevealInFinder,
}: Props) {
  const { t } = useI18n()
  const saveText =
    saveStatus === 'saving'
      ? t('notebook.saving')
      : saveStatus === 'dirty'
        ? t('notebook.unsaved')
        : t('notebook.saved')
  const pathText = diskLabel(note)

  return (
    <footer className="notebook-status-bar" aria-label={t('notebook.statusBarAria')}>
      <button type="button" className="notebook-status-item is-button" onClick={onPickLanguage}>
        <span className="notebook-status-key">{t('notebook.fileType')}</span>
        <span>
          {note.language}
          {extForLanguage(note.language)}
        </span>
      </button>
      <span className={`notebook-status-item is-role is-${note.role || 'note'}`}>
        {roleLabel(t, note.role)}
      </span>
      {onRevealInFinder ? (
        <button
          type="button"
          className="notebook-status-item is-button"
          title={t('notebook.revealInFinder')}
          {...pressProps(onRevealInFinder)}
        >
          <span className="notebook-status-key">{t('notebook.diskPath')}</span>
          <span className="notebook-status-path">{pathText}</span>
        </button>
      ) : (
        <span className="notebook-status-item" title={pathText}>
          <span className="notebook-status-key">{t('notebook.diskPath')}</span>
          <span className="notebook-status-path">{pathText}</span>
        </span>
      )}
      {hostName && (
        <span className="notebook-status-item" title={t('notebook.sshHost')}>
          {hostName}
        </span>
      )}
      {connectionName && (
        <span className="notebook-status-item" title={t('notebook.dbConnection')}>
          {connectionName}
        </span>
      )}
      <span className="notebook-status-spacer" />
      <span className={`notebook-status-item is-save is-${saveStatus}`}>{saveText}</span>
    </footer>
  )
}

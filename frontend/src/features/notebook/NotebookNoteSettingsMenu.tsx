import { useEffect, useRef, useState } from 'react'
import type { Connection, Note, NoteLanguage, NotebookGroup, ShellHost } from '../../api/types'
import { IconDatabase, IconDocker, IconServer, IconSettings } from '../../components/Icons'
import { Select, pressProps, useDismissOverlays } from '../../components/compat'
import { useI18n } from '../../i18n'
import {
  DEFAULT_NOTEBOOK_EDITOR_FONT,
  NOTEBOOK_EDITOR_FONT_SIZES,
  type NotebookEditorFontSize,
} from './notebookEditorFont'

type LangOption = { id: NoteLanguage; label: string }

type Props = {
  note: Note
  groups: NotebookGroup[]
  hosts: ShellHost[]
  connections: Connection[]
  languages: LangOption[]
  editorFontSize: NotebookEditorFontSize
  onEditorFontSizeChange: (size: NotebookEditorFontSize) => void
  onPatch: (patch: Partial<Note>) => void
  onConnectionLink: (connectionId: string) => void
}

/** NotebookNoteSettingsMenu 笔记设置：分组/语言/关联/编辑字号。 */
export function NotebookNoteSettingsMenu({
  note,
  groups,
  hosts,
  connections,
  languages,
  editorFontSize,
  onEditorFontSizeChange,
  onPatch,
  onConnectionLink,
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

  const linked = Boolean(note.sshHostId) || Boolean(note.connectionId)

  return (
    <div className="notebook-settings-menu" ref={rootRef}>
      <button
        type="button"
        className={`notebook-meta-icon-btn${linked ? ' is-linked' : ''}${open ? ' is-open' : ''}`}
        title={t('notebook.noteSettings')}
        aria-haspopup="menu"
        aria-expanded={open}
        {...pressProps(() => setOpen((v) => !v))}
      >
        <IconSettings size={14} />
      </button>
      {open && (
        <div className="notebook-settings-dropdown" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="notebook-settings-dropdown-head">{t('notebook.noteSettings')}</div>

          <label className="notebook-settings-field">
            <span>{t('notebook.editorFontSize')}</span>
            <Select
              className="notebook-settings-select"
              value={String(editorFontSize)}
              options={NOTEBOOK_EDITOR_FONT_SIZES.map((size) => ({
                value: String(size),
                label:
                  size === DEFAULT_NOTEBOOK_EDITOR_FONT
                    ? `${size}px · ${t('notebook.editorFontDefault')}`
                    : `${size}px`,
              }))}
              onChange={(v) => onEditorFontSizeChange(Number(v) as NotebookEditorFontSize)}
            />
          </label>

          <div className="notebook-settings-sep" />

          <label className="notebook-settings-field">
            <span>{t('notebook.groupTitle')}</span>
            <Select
              className="notebook-settings-select"
              value={note.groupId}
              options={[
                { value: '', label: t('notebook.rootGroup') },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
              onChange={(v) => onPatch({ groupId: v })}
            />
          </label>
          <label className="notebook-settings-field">
            <span>{t('notebook.language')}</span>
            <Select
              className="notebook-settings-select"
              value={note.language}
              options={languages.map((l) => ({ value: l.id, label: l.label }))}
              onChange={(v) => onPatch({ language: v as NoteLanguage })}
            />
          </label>
          <label className="notebook-settings-field">
            <span>{t('notebook.sshHost')}</span>
            <Select
              className="notebook-settings-select"
              value={note.sshHostId}
              options={[
                { value: '', label: t('notebook.noneLinked') },
                ...hosts.map((h) => ({
                  value: h.id,
                  label: h.kind === 'docker' ? `[Docker] ${h.name}` : h.name,
                })),
              ]}
              onChange={(v) => onPatch({ sshHostId: v })}
            />
          </label>
          <label className="notebook-settings-field">
            <span>{t('notebook.dbConnection')}</span>
            <Select
              className="notebook-settings-select"
              value={note.connectionId}
              title={t('notebook.dbLinkHint')}
              options={[
                { value: '', label: t('notebook.noneLinked') },
                ...connections.map((c) => ({ value: c.id, label: c.name })),
              ]}
              onChange={onConnectionLink}
            />
          </label>
          {linked && (
            <div className="notebook-settings-badges">
              {note.sshHostId && (
                <span className="notebook-host-badge">
                  {hosts.find((h) => h.id === note.sshHostId)?.kind === 'docker' ? (
                    <>
                      <IconDocker size={12} /> Docker
                    </>
                  ) : (
                    <>
                      <IconServer size={12} /> SSH
                    </>
                  )}
                </span>
              )}
              {note.connectionId && (
                <span className="notebook-host-badge">
                  <IconDatabase size={12} /> {connections.find((c) => c.id === note.connectionId)?.name ?? 'DB'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

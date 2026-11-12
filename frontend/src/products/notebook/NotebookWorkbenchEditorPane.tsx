import type { Ref } from 'react'
import type {
  Connection,
  Note,
  NoteLanguage,
  NotebookGroup,
  ShellHost,
} from '../../api/types'
import { IconPlay } from '../../components/Icons'
import { EmptyState } from '../../components/EmptyState'
import { pressProps } from '../../components/compat'
import { MarkdownPreview } from '../../features/notebook/MarkdownPreview'
import { NotebookMdViewToggle, type NotebookMdViewMode } from '../../features/notebook/NotebookMdViewToggle'
import { NotebookNoteMoreMenu } from '../../features/notebook/NotebookNoteMoreMenu'
import { NotebookNoteSettingsMenu } from '../../features/notebook/NotebookNoteSettingsMenu'
import { NotebookStatusBar } from '../../features/notebook/NotebookStatusBar'
import { NoteEditor, type NoteEditorHandle } from '../../features/notebook/NoteEditor'
import type { NotebookEditorFontSize } from '../../features/notebook/notebookEditorFont'
import { basenameRel } from '../../features/notebook/notebookPathOps'
import { useI18n } from '../../i18n'
import { openTabContextMenu, type TabContextMenuState } from '../../components/TabContextMenu'

type SaveStatus = 'saved' | 'dirty' | 'saving'

type LangOption = { id: NoteLanguage; label: string }

type Props = {
  tabsRef: Ref<HTMLDivElement>
  openTabIds: string[]
  openNotes: Record<string, Note>
  activeTabId: string | null
  saveByNote: Record<string, SaveStatus>
  setActiveTabId: (id: string | null) => void
  setTabCtxMenu: (v: TabContextMenuState | null) => void
  closeTab: (id: string) => void
  activeNote: Note | null
  activeCrumbs: string[]
  noteMdLike: boolean
  mdViewMode: NotebookMdViewMode
  setMdViewMode: (m: NotebookMdViewMode) => void
  noteEditorSplitClass: string
  showNoteEditor: boolean
  showNotePreview: boolean
  editorRef: Ref<NoteEditorHandle>
  editorFontSize: NotebookEditorFontSize
  onEditorFontSizeChange: (size: NotebookEditorFontSize) => void
  updateActiveNote: (patch: Partial<Note>) => void
  runInTerminal: () => void
  insertFilesAsAssets: (files: File[]) => void | Promise<void>
  pickAssets: (imagesOnly: boolean) => void | Promise<void>
  insertTemplate: () => void
  duplicateNote: () => void | Promise<void>
  exportNote: () => void | Promise<void>
  revealNoteInFinder: (noteId?: string) => void | Promise<void>
  openDatabase: (runSql?: boolean) => void
  onDeleteActive: () => void
  groups: NotebookGroup[]
  hosts: ShellHost[]
  connections: Connection[]
  languages: LangOption[]
  patchActiveNoteSettings: (patch: Partial<Note>) => void
  onConnectionLinkChange: (connectionId: string) => void
  settingsOpenSignal: number
  setSettingsOpenSignal: (fn: (n: number) => number) => void
  activeSaveStatus: SaveStatus
  flushSaveActive: () => void | Promise<void>
  activeHostName?: string
  activeConnName?: string
  openCreateFile: () => void
}

/** NotebookWorkbenchEditorPane 标签栏 + 编辑/预览主区（与侧栏数据域解耦）。 */
export function NotebookWorkbenchEditorPane({
  tabsRef,
  openTabIds,
  openNotes,
  activeTabId,
  saveByNote,
  setActiveTabId,
  setTabCtxMenu,
  closeTab,
  activeNote,
  activeCrumbs,
  noteMdLike,
  mdViewMode,
  setMdViewMode,
  noteEditorSplitClass,
  showNoteEditor,
  showNotePreview,
  editorRef,
  editorFontSize,
  onEditorFontSizeChange,
  updateActiveNote,
  runInTerminal,
  insertFilesAsAssets,
  pickAssets,
  insertTemplate,
  duplicateNote,
  exportNote,
  revealNoteInFinder,
  openDatabase,
  onDeleteActive,
  groups,
  hosts,
  connections,
  languages,
  patchActiveNoteSettings,
  onConnectionLinkChange,
  settingsOpenSignal,
  setSettingsOpenSignal,
  activeSaveStatus,
  flushSaveActive,
  activeHostName,
  activeConnName,
  openCreateFile,
}: Props) {
  const { t } = useI18n()

  return (
    <main className="app-main notebook-main">
      <div className="editor-chrome notebook-editor-chrome">
        <div className="wn-tabs" ref={tabsRef}>
          {openTabIds.map((id) => {
            const note = openNotes[id]
            if (!note) return null
            const dirty = saveByNote[id] === 'dirty' || saveByNote[id] === 'saving'
            return (
              <button
                key={id}
                type="button"
                data-tab-id={id}
                className={`wn-tab ${id === activeTabId ? 'active' : ''}${dirty ? ' is-dirty' : ''}`}
                {...pressProps(() => setActiveTabId(id))}
                onContextMenu={(e) => openTabContextMenu(e, id, setTabCtxMenu, setActiveTabId)}
              >
                {dirty && <span className="notebook-tab-dirty" aria-hidden />}
                <span className="tab-title">
                  {basenameRel(note.id) || note.title || t('common.unnamed')}
                </span>
                <span className="wn-tab-close" {...pressProps(() => closeTab(id), { stop: true })}>
                  ×
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {activeNote ? (
        <div className="notebook-editor-area">
          <div className="notebook-meta-bar notebook-ide-bar">
            <nav className="notebook-breadcrumb" aria-label={t('notebook.breadcrumbAria')}>
              {activeCrumbs.map((part, i) => (
                <span key={`${part}-${i}`} className="notebook-breadcrumb-part">
                  {i > 0 && <span className="notebook-breadcrumb-sep">/</span>}
                  <span>{part}</span>
                </span>
              ))}
              <span className="notebook-breadcrumb-sep">/</span>
              <span className="notebook-breadcrumb-file" title={activeNote.id}>
                {basenameRel(activeNote.id) || activeNote.title || t('common.unnamed')}
              </span>
            </nav>
            <div className="notebook-meta-bar-right">
              {noteMdLike && (
                <>
                  <NotebookMdViewToggle mode={mdViewMode} onChange={setMdViewMode} />
                  <div className="notebook-meta-divider" aria-hidden />
                </>
              )}
              <button
                type="button"
                className="notebook-meta-icon-btn"
                title={t('notebook.runTerminal')}
                {...pressProps(runInTerminal)}
              >
                <IconPlay size={14} />
              </button>
              <NotebookNoteMoreMenu
                hasConnection={Boolean(activeNote.connectionId)}
                onInsertImage={() => void pickAssets(true)}
                onInsertAttachment={() => void pickAssets(false)}
                onInsertTemplate={insertTemplate}
                onDuplicate={() => void duplicateNote()}
                onExport={() => void exportNote()}
                onRevealInFinder={() => void revealNoteInFinder(activeNote.id)}
                onOpenDatabase={() => openDatabase(true)}
                onDelete={onDeleteActive}
              />
              <NotebookNoteSettingsMenu
                note={activeNote}
                groups={groups}
                hosts={hosts}
                connections={connections}
                languages={languages}
                editorFontSize={editorFontSize}
                onEditorFontSizeChange={onEditorFontSizeChange}
                onPatch={patchActiveNoteSettings}
                onConnectionLink={onConnectionLinkChange}
                openSignal={settingsOpenSignal}
              />
              {(activeSaveStatus === 'dirty' || activeSaveStatus === 'saving') && (
                <button
                  type="button"
                  className={`wn-btn wn-btn-sm ${activeSaveStatus === 'dirty' ? 'wn-btn-primary' : 'wn-btn-ghost'}`}
                  disabled={activeSaveStatus === 'saving'}
                  title={t('notebook.saveShortcut')}
                  {...pressProps(() => void flushSaveActive(), {
                    disabled: activeSaveStatus === 'saving',
                  })}
                >
                  {activeSaveStatus === 'saving' ? t('notebook.saving') : t('notebook.save')}
                </button>
              )}
            </div>
          </div>
          <div
            className={`notebook-editor-split${noteEditorSplitClass}`}
            style={{ ['--notebook-editor-font-size' as string]: `${editorFontSize}px` }}
          >
            {showNoteEditor && (
              <NoteEditor
                ref={editorRef}
                noteId={activeNote.id}
                language={activeNote.language}
                content={activeNote.content}
                editorFontSize={editorFontSize}
                onChange={(content) => updateActiveNote({ content })}
                onRunSelection={runInTerminal}
                onInsertFiles={insertFilesAsAssets}
              />
            )}
            {showNotePreview && (
              <div
                className="notebook-preview-pane"
                title={mdViewMode === 'preview' ? t('notebook.previewEditHint') : undefined}
                onDoubleClick={mdViewMode === 'preview' ? () => setMdViewMode('source') : undefined}
              >
                {mdViewMode === 'preview' && (
                  <div className="notebook-preview-edit-bar">
                    <span>{t('notebook.previewOnlyHint')}</span>
                    <button
                      type="button"
                      className="wn-btn wn-btn-sm wn-btn-primary"
                      {...pressProps(() => setMdViewMode('source'))}
                    >
                      {t('notebook.enterEdit')}
                    </button>
                  </div>
                )}
                <MarkdownPreview content={activeNote.content} noteId={activeNote.id} />
              </div>
            )}
          </div>
          <NotebookStatusBar
            note={activeNote}
            saveStatus={activeSaveStatus}
            hostName={activeHostName}
            connectionName={activeConnName}
            onPickLanguage={() => setSettingsOpenSignal((n) => n + 1)}
            onRevealInFinder={() => void revealNoteInFinder(activeNote.id)}
          />
        </div>
      ) : (
        <EmptyState
          title={t('notebook.emptyWorkspace')}
          hint={t('notebook.emptyWorkspaceHint')}
          actions={[
            {
              label: t('notebook.newFile'),
              onPress: openCreateFile,
              primary: true,
            },
          ]}
        />
      )}
    </main>
  )
}

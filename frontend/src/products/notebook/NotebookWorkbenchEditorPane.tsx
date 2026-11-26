import { useEffect, useState, type Ref } from 'react'
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
import { DerivedViewBar } from '../../features/notebook/DerivedViewBar'
import { HtmlNoteFrame } from '../../features/notebook/HtmlNoteFrame'
import { useDerivedPageHtml } from '../../features/notebook/useDerivedPageHtml'
import { MarkdownPreview } from '../../features/notebook/MarkdownPreview'
import { NotebookMdViewToggle, type NotebookMdViewMode } from '../../features/notebook/NotebookMdViewToggle'
import { useGenerateNotePage } from '../../features/notebook/useGenerateNotePage'
import { NotebookNoteMoreMenu } from '../../features/notebook/NotebookNoteMoreMenu'
import { NotebookNoteSettingsMenu } from '../../features/notebook/NotebookNoteSettingsMenu'
import { NotebookStatusBar } from '../../features/notebook/NotebookStatusBar'
import { NoteEditor, type NoteEditorHandle } from '../../features/notebook/NoteEditor'
import { useNotebookAssetIngress } from '../../features/notebook/useNotebookAssetIngress'
import { useMdSplitScroll } from '../../features/notebook/useMdSplitScroll'
import type { NotebookEditorFontSize } from '../../features/notebook/notebookEditorFont'
import { linkedSourceNoteId, sourceNoteIdFromPage } from '../../features/notebook/derivedView'
import { isHtmlDocument } from '../../features/notebook/noteFileTypes'
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
  insertPathsAsAssets: (paths: string[]) => void | Promise<void>
  forgetResourceFile: (fileName: string) => void
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
  derivedPageId?: string
  onOpenNote: (id: string) => void
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
  insertPathsAsAssets,
  forgetResourceFile,
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
  derivedPageId,
  onOpenNote,
}: Props) {
  const splitScroll = useMdSplitScroll(mdViewMode === 'split')
  const htmlDoc = isHtmlDocument(activeNote?.language, activeNote?.id)
  const [htmlSource, setHtmlSource] = useState(false)
  useEffect(() => {
    setHtmlSource(false)
  }, [activeNote?.id])
  const pairedSourceId = activeNote ? sourceNoteIdFromPage(activeNote.id) : ''
  const generateNoteId = pairedSourceId || (noteMdLike && activeNote ? activeNote.id : '')
  const { generating, generate } = useGenerateNotePage(generateNoteId)
  const showHtmlPage = Boolean(activeNote) && htmlDoc && (Boolean(pairedSourceId) || !htmlSource)
  const showDerivedInline = noteMdLike && mdViewMode === 'page' && Boolean(derivedPageId)
  const pageHtml = useDerivedPageHtml(showDerivedInline, derivedPageId || '')
  const openLinkedSource = (id: string) => {
    if (activeNote && id === activeNote.id) setMdViewMode('split')
    else onOpenNote(id)
  }
  const { t } = useI18n()
  const ingress = useNotebookAssetIngress({
    enabled: Boolean(activeNote) && activeNote?.language !== 'image',
    onFiles: (files) => void insertFilesAsAssets(files),
    onPaths: (paths) => void insertPathsAsAssets(paths),
  })

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
              {(showHtmlPage || htmlSource) && !pairedSourceId ? (
                <button
                  type="button"
                  className="wn-btn wn-btn-xs"
                  {...pressProps(() => setHtmlSource((v) => !v))}
                >
                  {showHtmlPage ? t('notebook.viewHtmlSource') : t('notebook.viewHtmlPage')}
                </button>
              ) : null}
              {(noteMdLike || pairedSourceId) && (
                <>
                  <NotebookMdViewToggle
                    mode={pairedSourceId ? 'page' : mdViewMode}
                    onChange={(mode) => {
                      if (pairedSourceId && mode !== 'page') {
                        setMdViewMode(mode)
                        onOpenNote(pairedSourceId)
                        return
                      }
                      setMdViewMode(mode)
                    }}
                    showPage={Boolean(derivedPageId) || Boolean(pairedSourceId)}
                    onGenerate={generateNoteId ? () => void generate() : undefined}
                    generating={generating}
                  />
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
            ref={ingress.setHost}
            className={`notebook-editor-split notebook-asset-drop${noteEditorSplitClass}${ingress.dragOver ? ' is-drag-over' : ''}`}
            style={{ ['--notebook-editor-font-size' as string]: `${editorFontSize}px` }}
            onDragOver={ingress.onDragOver}
            onDragLeave={ingress.onDragLeave}
            onDrop={ingress.onDrop}
          >
            {showDerivedInline && activeNote ? (
              <>
                <DerivedViewBar noteId={derivedPageId || activeNote.id} html={pageHtml} onOpen={openLinkedSource} />
                <HtmlNoteFrame
                  title={basenameRel(activeNote.id) || activeNote.title}
                  html={pageHtml}
                  pageNoteId={derivedPageId || ''}
                  sourceId={activeNote.id}
                  onOpenSource={openLinkedSource}
                />
              </>
            ) : null}
            {showHtmlPage && activeNote && !showDerivedInline ? (
              <>
                <DerivedViewBar noteId={activeNote.id} html={activeNote.content} onOpen={onOpenNote} />
                <HtmlNoteFrame
                  title={basenameRel(activeNote.id) || activeNote.title}
                  html={activeNote.content}
                  pageNoteId={activeNote.id}
                  sourceId={linkedSourceNoteId(activeNote.id, activeNote.content)}
                  onOpenSource={onOpenNote}
                />
              </>
            ) : null}
            {showNoteEditor && !showHtmlPage && !showDerivedInline && (
              <NoteEditor
                ref={editorRef}
                noteId={activeNote.id}
                language={activeNote.language}
                content={activeNote.content}
                editorFontSize={editorFontSize}
                onChange={(content) => {
                  splitScroll.holdPreview()
                  updateActiveNote({ content })
                }}
                onRunSelection={runInTerminal}
                onScrollRatio={splitScroll.onEditorRatio}
                onBindScroll={splitScroll.bindEditorScroll}
              />
            )}
            {showNotePreview && (
              <div
                ref={splitScroll.previewRef}
                className="notebook-preview-pane"
                onScroll={splitScroll.onPreviewScroll}
                tabIndex={0}
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
                <MarkdownPreview
                  content={activeNote.content}
                  noteId={activeNote.id}
                  onForgetAsset={forgetResourceFile}
                />
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

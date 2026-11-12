import type { NoteRole, NoteSummary, NotebookGroup } from '../../api/types'
import { ContextMenu } from '../../components/ContextMenu'
import { pressProps } from '../../components/compat'
import { isMemoryProjectDir } from './businessRoots'
import type { NotebookClipboard } from './notebookPathOps'
import { opRelForNote } from './notebookPathOps'

export type NotebookSidebarCtxMenu =
  | { kind: 'folder'; x: number; y: number; group: NotebookGroup }
  | { kind: 'note'; x: number; y: number; note: NoteSummary }
  | { kind: 'root'; x: number; y: number }

type TFn = (key: string, params?: Record<string, string | number>) => string

/** 笔记本侧栏右键菜单（根 / 文件夹 / 笔记）。 */
export function NotebookSidebarContextMenu(props: {
  ctx: NotebookSidebarCtxMenu
  onDismiss: () => void
  treeRootId: string
  scopeRootsLength: number
  clipboard: NotebookClipboard | null
  versionBusy: boolean
  isProtectedDir: (id: string) => boolean
  beginInlineCreate: (parent: string, isDir: boolean) => void
  beginRename: (rel: string) => void
  pasteClipboard: (dest?: string) => Promise<void>
  cutRels: (rels: string[]) => void
  copyRels: (rels: string[]) => void
  createFolderVersion: (dir: string) => Promise<void>
  openVersionHistory: (dir: string) => void
  setProjectLocalDir: (id: string) => void | Promise<void>
  setProjectRemoteDir: (id: string) => void | Promise<void>
  onRevealPath: (rel: string) => void | Promise<void>
  onOpenNote: (id: string) => void
  onDeleteGroup: (id: string, title: string) => void
  onDeleteNote: (id: string, title: string) => void
  onMakeNoteRole: (noteId: string, role: NoteRole) => void
  t: TFn
}) {
  const {
    ctx,
    onDismiss,
    treeRootId,
    scopeRootsLength,
    clipboard,
    versionBusy,
    isProtectedDir,
    beginInlineCreate,
    beginRename,
    pasteClipboard,
    cutRels,
    copyRels,
    createFolderVersion,
    openVersionHistory,
    setProjectLocalDir,
    setProjectRemoteDir,
    onRevealPath,
    onOpenNote,
    onDeleteGroup,
    onDeleteNote,
    onMakeNoteRole,
    t,
  } = props

  return (
    <ContextMenu x={ctx.x} y={ctx.y} onDismiss={onDismiss} onClick={(e) => e.stopPropagation()}>
      {ctx.kind === 'root' && (
        <>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => beginInlineCreate(treeRootId, false))}
          >
            {scopeRootsLength ? t('notebook.newFile') : t('notebook.newInRoot')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => beginInlineCreate(treeRootId, true))}
          >
            {t('notebook.newGroup')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            disabled={!clipboard}
            {...pressProps(() => void pasteClipboard(treeRootId), { disabled: !clipboard })}
          >
            {t('notebook.ctxPaste')}
          </button>
        </>
      )}
      {ctx.kind === 'folder' && (
        <>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => beginInlineCreate(ctx.group.id, false))}
          >
            {t('notebook.newInGroup')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => beginInlineCreate(ctx.group.id, true))}
          >
            {t('notebook.newSubFolder')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            disabled={isProtectedDir(ctx.group.id)}
            {...pressProps(() => beginRename(ctx.group.id), {
              disabled: isProtectedDir(ctx.group.id),
            })}
          >
            {t('notebook.ctxRename')}
          </button>
          <div className="wn-context-sep" />
          <button
            type="button"
            className="wn-context-item"
            disabled={isProtectedDir(ctx.group.id)}
            {...pressProps(() => cutRels([ctx.group.id]), {
              disabled: isProtectedDir(ctx.group.id),
            })}
          >
            {t('notebook.ctxCut')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => copyRels([ctx.group.id]))}
          >
            {t('notebook.ctxCopy')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            disabled={!clipboard}
            {...pressProps(() => void pasteClipboard(ctx.group.id), { disabled: !clipboard })}
          >
            {t('notebook.ctxPaste')}
          </button>
          <div className="wn-context-sep" />
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              onDismiss()
              void onRevealPath(ctx.group.id)
            })}
          >
            {t('notebook.revealInFinder')}
          </button>
          {isMemoryProjectDir(ctx.group.id) && (
            <>
              <div className="wn-context-sep" />
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  const id = ctx.group.id
                  onDismiss()
                  void setProjectLocalDir(id)
                })}
              >
                {t('notebook.ctxSetLocalDir')}
              </button>
              <button
                type="button"
                className="wn-context-item"
                {...pressProps(() => {
                  const id = ctx.group.id
                  onDismiss()
                  void setProjectRemoteDir(id)
                })}
              >
                {t('notebook.ctxSetRemoteDir')}
              </button>
            </>
          )}
          <div className="wn-context-sep" />
          <button
            type="button"
            className="wn-context-item"
            disabled={versionBusy}
            {...pressProps(() => void createFolderVersion(ctx.group.id), { disabled: versionBusy })}
          >
            {t('notebook.dirVersionCreate')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => openVersionHistory(ctx.group.id))}
          >
            {t('notebook.ctxVersionHistory')}
          </button>
          <div className="wn-context-sep" />
          <button
            type="button"
            className="wn-context-item wn-context-item-danger"
            disabled={isProtectedDir(ctx.group.id)}
            {...pressProps(
              () => {
                const { group } = ctx
                onDismiss()
                onDeleteGroup(group.id, group.name)
              },
              { disabled: isProtectedDir(ctx.group.id) },
            )}
          >
            {t('notebook.deleteGroup')}
          </button>
        </>
      )}
      {ctx.kind === 'note' && (
        <>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              const { note } = ctx
              onDismiss()
              onOpenNote(note.id)
            })}
          >
            {t('notebook.ctxOpen')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => beginRename(opRelForNote(ctx.note.id)))}
          >
            {t('notebook.ctxRename')}
          </button>
          <div className="wn-context-sep" />
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => cutRels([opRelForNote(ctx.note.id)]))}
          >
            {t('notebook.ctxCut')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => copyRels([opRelForNote(ctx.note.id)]))}
          >
            {t('notebook.ctxCopy')}
          </button>
          <button
            type="button"
            className="wn-context-item"
            disabled={!clipboard}
            {...pressProps(() => void pasteClipboard(ctx.note.groupId || treeRootId), {
              disabled: !clipboard,
            })}
          >
            {t('notebook.ctxPaste')}
          </button>
          <div className="wn-context-sep" />
          <div className="wn-context-submenu-label">{t('notebook.ctxMakeAs')}</div>
          {(
            [
              { role: 'memory' as const, label: t('notebook.ctxMakeMemory') },
              { role: 'skill' as const, label: t('notebook.ctxMakeSkill') },
              { role: 'note' as const, label: t('notebook.ctxMakeNote') },
            ] as const
          ).map((item) => (
            <button
              key={item.role}
              type="button"
              className="wn-context-item wn-context-item-indent"
              disabled={(ctx.note.role || 'note') === item.role}
              {...pressProps(() => {
                const { note } = ctx
                onDismiss()
                onMakeNoteRole(note.id, item.role)
              })}
            >
              {item.label}
            </button>
          ))}
          <div className="wn-context-sep" />
          <button
            type="button"
            className="wn-context-item"
            {...pressProps(() => {
              onDismiss()
              void onRevealPath(ctx.note.id)
            })}
          >
            {t('notebook.revealInFinder')}
          </button>
          <button
            type="button"
            className="wn-context-item wn-context-item-danger"
            {...pressProps(() => {
              const { note } = ctx
              onDismiss()
              onDeleteNote(note.id, note.title)
            })}
          >
            {t('notebook.ctxDeleteNote')}
          </button>
        </>
      )}
    </ContextMenu>
  )
}

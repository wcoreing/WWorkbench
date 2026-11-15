import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { WorkbenchProject, WorkbenchProjectLink } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { IconFolder, IconPlus, IconRefresh, IconTrash } from '../../components/Icons'
import { pressProps } from '../../components/compat'
import {
  bindAssetsToAgent,
  type WorkbenchAssetRef,
} from '../../features/agent/agentAssetDrag'
import { openAgentDraft } from '../../features/agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { useAppStore } from '../../stores/appStore'
import {
  openBackup,
  openCapability,
  openDatabase,
  openHttpApi,
  openLogs,
  openNotebook,
  openTerminal,
} from '../../stores/productLink'
import { Capability } from '../../workbench/capabilities'
import { subscribeWorkbenchChanged } from '../../workbench/workbenchRadar'
import { model } from '../../../wailsjs/go/models'
import { ProjectAssetPicker } from './ProjectAssetPicker'
import './project.css'

function emptyDraft(): WorkbenchProject {
  return {
    id: '',
    name: '',
    localPath: '',
    gitRemote: '',
    links: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function normalizeLinks(links: WorkbenchProjectLink[] | undefined): WorkbenchProjectLink[] {
  const seen = new Set<string>()
  const out: WorkbenchProjectLink[] = []
  for (const l of links || []) {
    const kind = String(l.kind || '').trim()
    const id = String(l.id || '').trim()
    if (!kind || !id) continue
    const key = `${kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id, label: (l.label || '').trim() || id })
  }
  return out
}

function toDO(p: WorkbenchProject): model.WorkbenchProjectDO {
  return model.WorkbenchProjectDO.createFrom({
    id: p.id,
    name: p.name,
    localPath: p.localPath,
    gitRemote: p.gitRemote || '',
    links: normalizeLinks(p.links),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  })
}

function kindLabelKey(kind: string): string {
  switch (kind) {
    case 'ssh':
      return 'project.kindSsh'
    case 'database':
      return 'project.kindDatabase'
    case 'docker':
      return 'project.kindDocker'
    case 'log':
      return 'project.kindLog'
    case 'http':
      return 'project.kindHttp'
    case 'note':
      return 'project.kindNote'
    case 'backup':
      return 'project.kindBackup'
    case 'skill':
      return 'project.kindSkill'
    default:
      return 'project.kindNote'
  }
}

function openLinkedResource(link: WorkbenchProjectLink) {
  switch (link.kind) {
    case 'ssh':
      openTerminal({ hostId: link.id })
      return
    case 'database':
      openDatabase({ connectionId: link.id })
      return
    case 'docker':
      openCapability(Capability.DockerContextOpen, { contextId: link.id })
      return
    case 'log':
      openLogs({ logSourceId: link.id })
      return
    case 'http':
      openHttpApi({ requestId: link.id })
      return
    case 'note':
    case 'skill':
      openNotebook({ noteId: link.id })
      return
    case 'backup':
      openBackup({ policyId: link.id })
      return
    default:
      return
  }
}

/** ProjectWorkbench 项目组合产品：文件夹锚点 + 跨产品资源钉扎。 */
export function ProjectWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const [items, setItems] = useState<WorkbenchProject[]>([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState<WorkbenchProject>(emptyDraft())
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId])

  const load = useCallback(async () => {
    const list = await api.listWorkbenchProjects()
    setItems(list)
    return list
  }, [])

  useEffect(() => {
    void load().catch((e) => notify.error((e as Error).message))
  }, [load])

  useEffect(() => {
    return subscribeWorkbenchChanged((evt) => {
      if (evt.domain !== 'project') return
      void load()
        .then((list) => {
          if (evt.op === 'delete' && evt.ids?.includes(activeId)) {
            setActiveId('')
            setDraft(emptyDraft())
          } else if (evt.reveal && evt.ids?.[0]) {
            const id = evt.ids[0]
            const hit = list.find((p) => p.id === id)
            if (hit) {
              setActiveId(id)
              setDraft({ ...hit, links: normalizeLinks(hit.links) })
            }
          }
        })
        .catch(() => {})
    })
  }, [load, activeId])

  useEffect(() => {
    if (activeProduct !== 'project') return
    const links = normalizeLinks(draft.links)
    setAgentSurface({
      focusKind: 'project',
      focusLabel: draft.name || t('project.title'),
      tabTitle: draft.localPath || undefined,
      selectionBrief: [
        draft.id ? `project=${draft.id}` : '',
        draft.localPath ? `path=${draft.localPath}` : '',
        links.length ? `links=${links.length}` : '',
        ...links.slice(0, 6).map((l) => `${l.kind}:${l.label || l.id}`),
      ]
        .filter(Boolean)
        .join(' · '),
    })
  }, [activeProduct, draft, setAgentSurface, t])

  const fillGitRemote = async (localPath: string, current?: string) => {
    if ((current || '').trim()) return current || ''
    try {
      return (await api.detectWorkbenchProjectGitRemote(localPath)) || ''
    } catch {
      return ''
    }
  }

  const selectProject = (p: WorkbenchProject) => {
    setActiveId(p.id)
    const base = { ...p, links: normalizeLinks(p.links), gitRemote: p.gitRemote || '' }
    setDraft(base)
    if (!(p.gitRemote || '').trim() && (p.localPath || '').trim()) {
      void fillGitRemote(p.localPath, '').then((gitRemote) => {
        if (!gitRemote) return
        setDraft((d) => (d.id === p.id && !(d.gitRemote || '').trim() ? { ...d, gitRemote } : d))
      })
    }
  }

  const pickFolder = async () => {
    try {
      const picked = await api.pickLocalProjectDir(draft.localPath || '')
      if (!picked) return
      const base = picked.split(/[/\\]/).filter(Boolean).pop() || picked
      const gitRemote = await fillGitRemote(picked, draft.gitRemote)
      setDraft((d) => ({
        ...d,
        localPath: picked,
        name: d.name.trim() ? d.name : base,
        gitRemote: gitRemote || d.gitRemote || '',
      }))
      setStatusMessage(picked)
    } catch (e) {
      notify.error((e as Error).message)
    }
  }

  const createFromFolder = async () => {
    try {
      const picked = await api.pickLocalProjectDir('')
      if (!picked) return
      const base = picked.split(/[/\\]/).filter(Boolean).pop() || picked
      const gitRemote = await fillGitRemote(picked, '')
      const next: WorkbenchProject = {
        ...emptyDraft(),
        name: base,
        localPath: picked,
        gitRemote,
        links: [],
      }
      setBusy(true)
      const saved = await api.saveWorkbenchProject(toDO(next))
      await load()
      selectProject(saved)
      notify.success(t('project.saved'))
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    try {
      setBusy(true)
      const saved = await api.saveWorkbenchProject(
        toDO({
          ...draft,
          links: normalizeLinks(draft.links),
        }),
      )
      await load()
      selectProject(saved)
      notify.success(t('project.saved'))
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!draft.id) {
      setPendingDelete(false)
      setDraft(emptyDraft())
      setActiveId('')
      return
    }
    try {
      setBusy(true)
      await api.deleteWorkbenchProject(draft.id)
      setPendingDelete(false)
      setActiveId('')
      setDraft(emptyDraft())
      await load()
      notify.success(t('project.deleted'))
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pinLink = (link: WorkbenchProjectLink) => {
    setDraft((d) => ({ ...d, links: normalizeLinks([...d.links, link]) }))
  }

  const runSyncCursorTranscriptsViaAgent = () => {
    if (!draft.id) {
      notify.error(t('project.syncCursorNeedSave'))
      return
    }
    if (!draft.localPath) {
      notify.error(t('project.smartNeedPath'))
      return
    }
    openAgentDraft({
      mentions: [],
      message:
        `请同步项目「${draft.name || draft.localPath}」(id=${draft.id}) 的 Cursor 对话：调用 sync_project_cursor_transcripts(id=${draft.id}, intent=同步Cursor对话到项目仓库以便跨机续上下文)。` +
        `完成后 list_project_cursor_transcripts 确认；提醒提交 .wworkbench/cursor-transcripts/。不要用 requestId。`,
      autoSend: true,
      mode: 'agent',
    })
    notify.success(t('project.syncCursorHandedToAgent'))
  }

  const runSmartConfigViaAgent = async () => {
    if (!draft.localPath && !draft.name) {
      notify.error(t('project.smartNeedPath'))
      return
    }
    // 先尽量把 git 填上，再交给 Agent 做资源组合（配置只经 Agent/MCP）
    let gitRemote = (draft.gitRemote || '').trim()
    if (!gitRemote && draft.localPath) {
      gitRemote = await fillGitRemote(draft.localPath, '')
      if (gitRemote) {
        setDraft((d) => ({ ...d, gitRemote }))
      }
    }
    if (draft.id && gitRemote && !(draft.gitRemote || '').trim()) {
      try {
        await api.saveWorkbenchProject(toDO({ ...draft, gitRemote }))
      } catch {
        /* Agent 仍可 detect_project_git */
      }
    }
    const path = draft.localPath || draft.name || t('project.title')
    const msg = draft.id
      ? `请为项目「${draft.name || path}」(id=${draft.id}) 智能配置：1) detect_project_git 或确认 gitRemote 已填；2) suggest_project_resources(id=…)；3) 核对后 configure_project_resources(id=…, keys=[选中的 kind:id] 或空=全采纳未钉, intent=智能配置项目资源)。不要瞎钉无关主机。`
      : `请为项目「${draft.name || path}」路径 ${draft.localPath || ''} 智能配置：先 save_project(name/localPath，gitRemote 可空会自动探测)，再 suggest_project_resources(id=…) → configure_project_resources。不要瞎钉无关主机。`
    openAgentDraft({
      mentions: [],
      message: msg,
      autoSend: true,
      mode: 'agent',
    })
    notify.success(t('project.smartHandedToAgent'))
  }

  const removeLink = (kind: string, id: string) => {
    setDraft((d) => ({
      ...d,
      links: d.links.filter((l) => !(l.kind === kind && l.id === id)),
    }))
  }

  const pinToAgent = () => {
    const assets: WorkbenchAssetRef[] = normalizeLinks(draft.links)
      .filter((l) => ['ssh', 'database', 'docker', 'log', 'http', 'note', 'skill'].includes(l.kind))
      .map((l) => ({
        kind: l.kind as WorkbenchAssetRef['kind'],
        id: l.id,
        label: l.label || l.id,
      }))
    if (!assets.length) return
    bindAssetsToAgent(assets)
    notify.success(t('project.boundToAgent'))
  }

  const showEditor = Boolean(draft.id || draft.localPath || draft.name)

  return (
    <div className="product-workbench project-workbench">
      <div className="product-toolbar">
        <div className="product-actions">
          <button type="button" className="wn-btn wn-btn-tool" disabled={busy} title={t('project.new')} {...pressProps(() => void createFromFolder())}>
            <IconPlus size={16} />
            <span>{t('project.new')}</span>
          </button>
          <button type="button" className="wn-btn wn-btn-tool" disabled={busy} title={t('common.refresh')} {...pressProps(() => void load())}>
            <IconRefresh size={16} />
          </button>
        </div>
      </div>

      <div className="product-body">
        <aside className="app-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>{t('project.list')}</span>
              <div className="project-sidebar-header-actions">
                <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" title={t('project.new')} {...pressProps(() => void createFromFolder())}>
                  <IconFolder size={14} />
                </button>
              </div>
            </div>
            <div className="sidebar-body">
              {items.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title={t('project.empty')}
                  hint={t('project.emptyHint')}
                  actions={[{ label: t('project.pickFolder'), onPress: () => void createFromFolder(), primary: true }]}
                />
              ) : (
                <ul className="project-list">
                  {items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`project-list-row${activeId === p.id ? ' is-active' : ''}`}
                        onClick={() => selectProject(p)}
                      >
                        <span className="project-list-name">{p.name || t('project.title')}</span>
                        <span className="project-list-path">{p.localPath || '—'}</span>
                        <span className="project-list-meta">{normalizeLinks(p.links).length} links</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <main className="project-main">
          {!showEditor ? (
            <EmptyState
              title={t('project.selectHint')}
              hint={t('project.emptyHint')}
              actions={[{ label: t('project.pickFolder'), onPress: () => void createFromFolder(), primary: true, icon: <IconFolder size={14} /> }]}
            />
          ) : (
            <>
              <section className="project-section">
                <div className="project-field">
                  <label>{t('project.name')}</label>
                  <input
                    value={draft.name}
                    placeholder={t('project.namePlaceholder')}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div className="project-field">
                  <label>{t('project.localPath')}</label>
                  <div className="project-path-row">
                    <input value={draft.localPath} readOnly placeholder={t('project.pickFolder')} />
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void pickFolder())}>
                      {draft.localPath ? t('project.changeFolder') : t('project.pickFolder')}
                    </button>
                  </div>
                </div>
                <div className="project-field">
                  <label>{t('project.gitRemote')}</label>
                  <input
                    value={draft.gitRemote || ''}
                    placeholder={t('project.gitRemotePlaceholder')}
                    onChange={(e) => setDraft((d) => ({ ...d, gitRemote: e.target.value }))}
                  />
                </div>
              </section>

              <section className="project-section">
                <div className="project-links-header">
                  <div className="project-section-title">{t('project.links')}</div>
                  <div className="project-links-header-actions">
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void runSmartConfigViaAgent())}>
                      <span>{t('project.smartConfig')}</span>
                    </button>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(runSyncCursorTranscriptsViaAgent)}>
                      <span>{t('project.syncCursor')}</span>
                    </button>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => setPickerOpen(true))}>
                      <IconPlus size={14} />
                      <span>{t('project.addResource')}</span>
                    </button>
                  </div>
                </div>
                <p className="project-path-text">{t('project.linksHint')}</p>
                <div className="project-dropzone">
                  {normalizeLinks(draft.links).length === 0 ? (
                    <div className="project-links-empty">
                      <span>{t('project.linksEmpty')}</span>
                      <div className="project-links-empty-actions">
                        <button type="button" className="wn-btn wn-btn-primary wn-btn-sm" {...pressProps(() => void runSmartConfigViaAgent())}>
                          {t('project.smartConfig')}
                        </button>
                        <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => setPickerOpen(true))}>
                          {t('project.addResource')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <ul className="project-links">
                      {normalizeLinks(draft.links).map((link) => (
                        <li key={`${link.kind}:${link.id}`} className="project-link-row">
                          <span className="project-link-kind">{t(kindLabelKey(link.kind))}</span>
                          <div className="project-link-body" onClick={() => openLinkedResource(link)} title={t('project.openLink')}>
                            <span className="project-link-label">{link.label || link.id}</span>
                            <span className="project-link-id">
                              {link.kind}:{link.id}
                            </span>
                          </div>
                          <div className="project-link-actions">
                            <button
                              type="button"
                              className="wn-btn wn-btn-icon wn-btn-sm"
                              title={t('project.removeLink')}
                              {...pressProps(() => removeLink(link.kind, link.id))}
                            >
                              <IconTrash size={14} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <div className="project-actions-bar">
                <button type="button" className="wn-btn wn-btn-primary wn-btn-sm" disabled={busy || !draft.localPath} {...pressProps(() => void save())}>
                  {t('project.save')}
                </button>
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool"
                  disabled={!normalizeLinks(draft.links).some((l) => ['ssh', 'database', 'docker', 'log', 'http', 'note', 'skill'].includes(l.kind))}
                  {...pressProps(pinToAgent)}
                >
                  {t('project.bindToAgent')}
                </button>
                <button type="button" className="wn-btn wn-btn-sm wn-btn-tool danger" disabled={busy || !draft.id} {...pressProps(() => setPendingDelete(true))}>
                  {t('project.delete')}
                </button>
              </div>
            </>
          )}
        </main>
      </div>

      <ProjectAssetPicker
        open={pickerOpen}
        linked={normalizeLinks(draft.links)}
        onPick={pinLink}
        onClose={() => setPickerOpen(false)}
      />

      <ConfirmDialog
        open={pendingDelete}
        title={t('project.deleteTitle')}
        message={t('project.deleteMsg')}
        confirmLabel={t('project.delete')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  )
}

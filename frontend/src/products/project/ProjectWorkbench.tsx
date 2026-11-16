import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { AgentMentionKind } from '../../features/agent/agentMention'
import { openAgentDraft } from '../../features/agent/openAgentDraft'
import { NOTEBOOK_ROOT_PROJECT } from '../../features/notebook/businessRoots'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'
import { useAppStore } from '../../stores/appStore'
import {
  isPanelReadyKind,
  loadStageLayout,
  openResource,
  ResourceStage,
  saveStageLayout,
  useResourceWindowStore,
  type ResourceKind,
  type ResourceWindow,
} from '../../workbench/resourceWindow'
import { subscribeWorkbenchChanged } from '../../workbench/workbenchRadar'
import { model } from '../../../wailsjs/go/models'
import { ProjectAssetPicker } from './ProjectAssetPicker'
import './project.css'

const LAST_PROJECT_SETTING = 'last_workbench_project_id'
const MENTION_KINDS: AgentMentionKind[] = ['ssh', 'database', 'docker', 'log', 'http', 'note']
/** 稳定空数组：避免 stage selector 每次新引用。 */
const EMPTY_STAGE_PANELS: ResourceWindow[] = []
const LEGACY_EXPERIENCE_KEY = 'wwb.project.experience.'

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

/** safeProjectDirName 与后端 SafeProjectDirName 对齐，用于 项目/{名} 寻址。 */
function safeProjectDirName(name: string): string {
  let out = name
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
  out = out.replace(/^[.\s]+|[.\s]+$/g, '')
  const chars = [...out]
  if (chars.length > 80) out = chars.slice(0, 80).join('')
  return out || 'untitled'
}

function projectNotebookDir(name: string): string {
  return `${NOTEBOOK_ROOT_PROJECT}/${safeProjectDirName(name)}`
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
    case 'sftp':
      return 'project.kindSftp'
    default:
      return 'project.kindNote'
  }
}

/** 旧「单条经验条」并入 links（项目可挂多个 skill），并清掉 localStorage。 */
function absorbLegacyExperience(projectId: string, links: WorkbenchProjectLink[]): WorkbenchProjectLink[] {
  const id = projectId.trim()
  if (!id || typeof localStorage === 'undefined') return links
  const key = `${LEGACY_EXPERIENCE_KEY}${id}`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return links
    localStorage.removeItem(key)
    const parsed = JSON.parse(raw) as { skillDir?: string; skillPath?: string }
    const skillDir = String(parsed.skillDir || '').trim()
    const skillPath = String(parsed.skillPath || '').trim()
    if (!skillDir || !skillPath) return links
    const exists = links.some(
      (l) =>
        l.kind === 'skill' &&
        (l.id === skillPath || l.id === skillDir || l.label === skillDir),
    )
    if (exists) return links
    return normalizeLinks([...links, { kind: 'skill', id: skillPath, label: skillDir }])
  } catch {
    return links
  }
}

/** 项目默认 Skill 也算资源：保证 项目/{名}/SKILL.md 在 links 里。 */
function ensureProjectSkillLink(projectName: string, links: WorkbenchProjectLink[]): WorkbenchProjectLink[] {
  const name = projectName.trim()
  if (!name) return links
  const skillDir = projectNotebookDir(name)
  const skillPath = `${skillDir}/SKILL.md`
  const exists = links.some(
    (l) =>
      l.kind === 'skill' &&
      (l.id === skillPath || l.id === skillDir || l.label === skillDir || l.label === skillPath),
  )
  if (exists) return links
  return normalizeLinks([...links, { kind: 'skill', id: skillPath, label: skillDir }])
}

function hydrateProjectLinks(p: WorkbenchProject): WorkbenchProjectLink[] {
  const raw = normalizeLinks(p.links)
  return ensureProjectSkillLink(p.name, absorbLegacyExperience(p.id, raw))
}

function linksFingerprint(links: WorkbenchProjectLink[]): string {
  return normalizeLinks(links)
    .map((l) => `${l.kind}:${l.id}`)
    .join('|')
}

/** ProjectWorkbench 项目组合产品：文件夹锚点 + 跨产品资源钉扎 + 资源舞台。 */
export function ProjectWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const [items, setItems] = useState<WorkbenchProject[]>([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState<WorkbenchProject>(emptyDraft())
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({})
  const restoredRef = useRef(false)
  const stageLayoutRestoredRef = useRef('')
  const stageLayoutReadyRef = useRef(false)
  const stageLayoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const list = await api.listWorkbenchProjects()
    setItems(list)
    return list
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const list = await load()
        if (restoredRef.current) return
        restoredRef.current = true
        const settings = await api.listAppSettings()
        const lastId = String(settings[LAST_PROJECT_SETTING] || '').trim()
        const hit = lastId ? list.find((p) => p.id === lastId) : undefined
        const pick = hit || list[0]
        if (pick) {
          setActiveId(pick.id)
          const links = hydrateProjectLinks(pick)
          setDraft({ ...pick, links, gitRemote: pick.gitRemote || '' })
          if (linksFingerprint(links) !== linksFingerprint(pick.links)) {
            void api.saveWorkbenchProject(toDO({ ...pick, links, gitRemote: pick.gitRemote || '' })).catch(() => {})
          }
        }
      } catch (e) {
        notify.error((e as Error).message)
      }
    })()
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
              const links = hydrateProjectLinks(hit)
              setDraft({ ...hit, links })
              if (linksFingerprint(links) !== linksFingerprint(hit.links)) {
                void api.saveWorkbenchProject(toDO({ ...hit, links })).catch(() => {})
              }
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
    const links = hydrateProjectLinks(p)
    const base = { ...p, links, gitRemote: p.gitRemote || '' }
    setDraft(base)
    setSelectedKeys({})
    stageLayoutRestoredRef.current = ''
    stageLayoutReadyRef.current = false
    if (p.id) {
      void api.setAppSetting(LAST_PROJECT_SETTING, p.id).catch(() => {})
      if (linksFingerprint(links) !== linksFingerprint(p.links)) {
        void api.saveWorkbenchProject(toDO(base)).catch(() => {})
      }
    }
    if (!(p.gitRemote || '').trim() && (p.localPath || '').trim()) {
      void fillGitRemote(p.localPath, '').then((gitRemote) => {
        if (!gitRemote) return
        setDraft((d) => (d.id === p.id && !(d.gitRemote || '').trim() ? { ...d, gitRemote } : d))
      })
    }
  }

  const projectMentions = useCallback((): WorkbenchAssetRef[] => {
    return normalizeLinks(draft.links)
      .filter((l) => MENTION_KINDS.includes(l.kind as AgentMentionKind))
      .map((l) => ({
        kind: l.kind as AgentMentionKind,
        id: l.id,
        label: l.label || l.id,
      }))
  }, [draft.links])

  const stageKey = draft.id || 'project-draft'
  const stagePanels = useResourceWindowStore((s) => s.panelsByStage[stageKey] ?? EMPTY_STAGE_PANELS)
  const stageOpen = stagePanels.length > 0

  /** 总结经验：交给助手把稳定步骤写回项目 Skill。 */
  const distillSkill = () => {
    const projectName = draft.name.trim()
    if (!projectName && !draft.localPath) {
      notify.error(t('project.smartNeedPath'))
      return
    }
    const skillDir = projectNotebookDir(
      projectName || draft.localPath.split(/[/\\]/).filter(Boolean).pop() || 'untitled',
    )
    const skillPath = `${skillDir}/SKILL.md`
    const mentions = projectMentions()
    const linkedSkills = normalizeLinks(draft.links)
      .filter((l) => l.kind === 'skill')
      .map((l) => l.id)
    const skills = linkedSkills.length ? linkedSkills : [skillDir]
    const name = projectName || skillDir
    openAgentDraft({
      mentions,
      skillIds: skills,
      mode: 'agent',
      autoSend: true,
      message: t('project.distillMsg', {
        name,
        skillDir,
        skillPath,
        skillHint: linkedSkills.length
          ? linkedSkills.map((id) => `get_skill → update_skill(name=${id})`).join('；')
          : t('project.distillNoSkillHint', { skillDir }),
      }),
    })
    const already = linkedSkills.some((id) => id === skillPath || id === skillDir)
    if (!already) {
      setDraft((d) => ({
        ...d,
        links: normalizeLinks([...d.links, { kind: 'skill', id: skillPath, label: skillDir }]),
      }))
    }
    notify.success(t('project.distillHanded'))
  }

  const flatLinks = useMemo(() => normalizeLinks(draft.links), [draft.links])

  const selectedLinks = useMemo(() => {
    return normalizeLinks(draft.links).filter((l) => selectedKeys[`${l.kind}:${l.id}`])
  }, [draft.links, selectedKeys])

  const toggleSelectLink = (link: WorkbenchProjectLink) => {
    const key = `${link.kind}:${link.id}`
    setSelectedKeys((prev) => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  const openLinkedResource = (
    link: WorkbenchProjectLink,
    presentation: 'panel' | 'dialog' | 'product' = 'dialog',
  ) => {
    const kind = link.kind as ResourceKind
    openResource({
      kind,
      resourceId: link.id,
      title: link.label || link.id,
      presentation:
        (presentation === 'panel' || presentation === 'dialog') && !isPanelReadyKind(kind)
          ? 'product'
          : presentation,
      stageKey,
    })
  }

  const openSelectedToStage = () => {
    const ready = selectedLinks.filter((l) => isPanelReadyKind(l.kind as ResourceKind))
    for (const link of ready) {
      openLinkedResource(link, 'panel')
    }
    setSelectedKeys({})
  }

  // 恢复项目舞台布局（仅空舞台时）；完成前禁止把空布局写回覆盖。
  useEffect(() => {
    const id = draft.id
    if (!id) {
      stageLayoutReadyRef.current = false
      return
    }
    if (stageLayoutRestoredRef.current === id) return
    stageLayoutRestoredRef.current = id
    stageLayoutReadyRef.current = false
    void loadStageLayout(id)
      .then((items) => {
        const current = useResourceWindowStore.getState().panelsByStage[id]
        if (!current?.length && items.length) {
          for (const item of items.slice(0, 4)) {
            if (!isPanelReadyKind(item.kind)) continue
            openResource({
              kind: item.kind,
              resourceId: item.resourceId,
              title: item.title,
              presentation: 'panel',
              stageKey: id,
            })
          }
        }
      })
      .finally(() => {
        if (stageLayoutRestoredRef.current === id) stageLayoutReadyRef.current = true
      })
  }, [draft.id])

  // 持久化舞台布局
  useEffect(() => {
    const id = draft.id
    if (!id || !stageLayoutReadyRef.current) return
    if (stageLayoutSaveTimer.current) clearTimeout(stageLayoutSaveTimer.current)
    stageLayoutSaveTimer.current = setTimeout(() => {
      if (!stageLayoutReadyRef.current || stageLayoutRestoredRef.current !== id) return
      void saveStageLayout(
        id,
        stagePanels.map((p) => ({
          kind: p.kind,
          resourceId: p.resourceId,
          title: p.title,
        })),
      ).catch(() => {})
    }, 400)
    return () => {
      if (stageLayoutSaveTimer.current) clearTimeout(stageLayoutSaveTimer.current)
    }
  }, [draft.id, stagePanels])

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
    const skillDir = projectNotebookDir((draft.name || path).trim() || 'untitled')
    const msg = draft.id
      ? `请为项目「${draft.name || path}」(id=${draft.id}) 智能配置：1) detect_project_git 或确认 gitRemote 已填；2) suggest_project_resources(id=…)；3) 核对后 configure_project_resources(id=…, keys=[选中的 kind:id] 或空=全采纳未钉, intent=智能配置项目资源)。经验沉淀用 update_skill(name=${skillDir})，禁止落到工作流/。不要瞎钉无关主机。`
      : `请为项目「${draft.name || path}」路径 ${draft.localPath || ''} 智能配置：先 save_project(name/localPath，gitRemote 可空会自动探测)，再 suggest_project_resources(id=…) → configure_project_resources。经验沉淀用 update_skill(name=${skillDir})，禁止落到工作流/。不要瞎钉无关主机。`
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
    const assets = projectMentions()
    const skills = normalizeLinks(draft.links)
      .filter((l) => l.kind === 'skill')
      .map((l) => l.id)
    if (!assets.length && !skills.length) return
    openAgentDraft({ mentions: assets, skillIds: skills.length ? skills : undefined })
    notify.success(t('project.boundToAgent'))
  }

  const showEditor = Boolean(draft.id || draft.localPath || draft.name)
  const linkCount = normalizeLinks(draft.links).length

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
              <header className="project-hero">
                <div className="project-hero-main">
                  <input
                    className="project-hero-name"
                    value={draft.name}
                    placeholder={t('project.namePlaceholder')}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    aria-label={t('project.name')}
                  />
                  <div className="project-hero-meta">
                    <span className="project-hero-path" title={draft.localPath || undefined}>
                      {draft.localPath || t('project.pickFolder')}
                    </span>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void pickFolder())}>
                      {draft.localPath ? t('project.changeFolder') : t('project.pickFolder')}
                    </button>
                  </div>
                  <div className="project-hero-git">
                    <label htmlFor="project-git-remote">{t('project.gitRemote')}</label>
                    <input
                      id="project-git-remote"
                      value={draft.gitRemote || ''}
                      placeholder={t('project.gitRemotePlaceholder')}
                      onChange={(e) => setDraft((d) => ({ ...d, gitRemote: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="project-hero-actions">
                  <button type="button" className="wn-btn wn-btn-primary wn-btn-sm" disabled={busy || !draft.localPath} {...pressProps(() => void save())}>
                    {t('project.save')}
                  </button>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={busy} {...pressProps(distillSkill)}>
                    {t('project.distill')}
                  </button>
                  <button
                    type="button"
                    className="wn-btn wn-btn-sm wn-btn-tool"
                    disabled={!projectMentions().length && !normalizeLinks(draft.links).some((l) => l.kind === 'skill')}
                    {...pressProps(pinToAgent)}
                  >
                    {t('project.bindToAgent')}
                  </button>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool danger" disabled={busy || !draft.id} {...pressProps(() => setPendingDelete(true))}>
                    {t('project.delete')}
                  </button>
                </div>
              </header>

              <div className={`project-workspace${stageOpen ? ' is-split' : ''}`}>
                <section className="project-resources">
                  <div className="project-links-header">
                    <div className="project-section-title">
                      {t('project.links')}
                      {linkCount > 0 ? <span className="project-links-count">{linkCount}</span> : null}
                    </div>
                    <div className="project-links-header-actions">
                      {selectedLinks.length > 0 ? (
                        <button
                          type="button"
                          className="wn-btn wn-btn-sm wn-btn-primary"
                          title={t('project.openSelectedStageHint')}
                          {...pressProps(openSelectedToStage)}
                        >
                          {t('project.openSelectedStage', { n: String(selectedLinks.length) })}
                        </button>
                      ) : null}
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
                  <div className="project-dropzone">
                    {linkCount === 0 ? (
                      <div className="project-links-empty">
                        <span>{t('project.linksEmpty')}</span>
                        <p className="project-links-empty-hint">{t('project.guide1')}</p>
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
                        {flatLinks.map((link) => {
                          const kind = link.kind as ResourceKind
                          const canPanel = isPanelReadyKind(kind)
                          const key = `${link.kind}:${link.id}`
                          const checked = !!selectedKeys[key]
                          return (
                            <li
                              key={key}
                              className={`project-link-row${checked ? ' is-selected' : ''}`}
                            >
                              <input
                                type="checkbox"
                                className="project-link-check"
                                checked={checked}
                                title={t('project.selectForStage')}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleSelectLink(link)}
                              />
                              <span className="project-link-kind" data-kind={link.kind}>
                                {t(kindLabelKey(link.kind))}
                              </span>
                              <div
                                className="project-link-body"
                                onClick={() => openLinkedResource(link)}
                                title={`${link.kind}:${link.id}`}
                              >
                                <span className="project-link-label">{link.label || link.id}</span>
                              </div>
                              <div className="project-link-actions">
                                {canPanel ? (
                                  <button
                                    type="button"
                                    className="wn-btn wn-btn-sm wn-btn-tool"
                                    title={t('resourceWindow.openAsPanel')}
                                    {...pressProps(() => openLinkedResource(link, 'panel'))}
                                  >
                                    {t('resourceWindow.openAsPanelShort')}
                                  </button>
                                ) : null}
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
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </section>

                {stageOpen ? (
                  <section className="project-stage-dock" aria-label={t('resourceWindow.stageTitle')}>
                    <div className="project-section-title">{t('resourceWindow.stageTitle')}</div>
                    <ResourceStage stageKey={stageKey} hideEmpty />
                  </section>
                ) : null}
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

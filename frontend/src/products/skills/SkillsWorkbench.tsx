import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DirTree } from '../../components/DirTree'
import { IconPlus, IconRefresh, IconSave, IconTrash } from '../../components/Icons'
import { NoteEditor } from '../../features/notebook/NoteEditor'
import { openAgentDraft } from '../../features/agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { buildSkillsSurface, briefList } from '../../stores/agentSurface'
import { subscribeWorkbenchChanged, takePendingWorkbenchChanged, type WorkbenchChangedEvent } from '../../workbench/workbenchRadar'
import { model } from '../../../wailsjs/go/models'
import { pressProps, useDismissOverlays } from '../../components/compat'
import { isSkillMarkdown, skillIdFromPath } from './skillsPath'

const PROTECTED_SKILL_ID = 'skill-creator'
const SKILLS_ROOT = 'system/skills'

interface SkillMeta {
  id: string
  name: string
  enabled: boolean
  builtin: boolean
}

/** SkillsWorkbench Agent 技能工作区（system/skills/ 文件树 + 编辑）。 */
export function SkillsWorkbench() {
  const { t } = useI18n()
  const { setStatusMessage, setAgentSurface, activeProduct } = useAppStore()
  const [metaById, setMetaById] = useState<Record<string, SkillMeta>>({})
  const [activePath, setActivePath] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [treeRefreshKey, setTreeRefreshKey] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<SkillMeta | null>(null)
  const loadedRef = useRef('')

  const activeSkillId = skillIdFromPath(activePath)
  const activeMeta = activeSkillId ? metaById[activeSkillId] : undefined
  const editingSkillMd = isSkillMarkdown(activePath)

  const listSkillsDir = useCallback(async (subPath: string) => {
    const entries = await api.listSkillsDir(subPath)
    return entries.map((e) => ({ name: e.name, path: e.path, isDir: e.isDir }))
  }, [])

  const refreshMeta = useCallback(
    async (keepPath?: string) => {
      setLoading(true)
      try {
        const skills = await api.listAgentSkills()
        const meta: Record<string, SkillMeta> = {}
        for (const s of skills) {
          meta[s.id] = { id: s.id, name: s.name, enabled: s.enabled, builtin: s.builtin }
        }
        setMetaById(meta)
        setTreeRefreshKey((k) => k + 1)

        if (keepPath) {
          if (keepPath !== activePath) {
            setActivePath(keepPath)
            loadedRef.current = ''
          }
        } else if (!activePath && skills.length > 0) {
          const pick = skills.find((s) => s.enabled) ?? skills[0]
          setActivePath(`${pick.id}/SKILL.md`)
          loadedRef.current = ''
        } else if (activePath && !meta[skillIdFromPath(activePath)]) {
          loadedRef.current = ''
          setActivePath('')
          setContent('')
        }
      } catch (e) {
        setStatusMessage((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [activePath, setStatusMessage],
  )

  const loadFile = useCallback(
    async (path: string) => {
      if (!path) return
      try {
        const body = await api.getAgentSkillFile(path)
        loadedRef.current = path
        setContent(body || '')
        setDirty(false)
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    },
    [setStatusMessage],
  )

  useEffect(() => {
    if (activeProduct !== 'skills') return
    for (const evt of takePendingWorkbenchChanged('agent.skill')) {
      const id = evt.ids[0]
      if (id) setActivePath(`${id}/SKILL.md`)
    }
    void refreshMeta(activePath || undefined)
  }, [activeProduct])

  useEffect(() => {
    if (activeProduct !== 'skills' || !activePath) return
    if (loadedRef.current === activePath) return
    void loadFile(activePath)
  }, [activeProduct, activePath, loadFile])

  useEffect(() => {
    if (activeProduct !== 'skills') return
    setAgentSurface(
      buildSkillsSurface({
        skillId: activeSkillId || undefined,
        name: activeMeta?.name,
        openTabsBrief: briefList(Object.values(metaById).map((s) => s.name), 12),
      }),
    )
  }, [activeProduct, activeSkillId, activeMeta, metaById, setAgentSurface])

  useEffect(() => {
    if (activeProduct !== 'skills') return
    return subscribeWorkbenchChanged((evt: WorkbenchChangedEvent) => {
      if (evt.domain === 'agent.skill') {
        const id = evt.ids[0]
        const keep = activePath || (id ? `${id}/SKILL.md` : '')
        void refreshMeta(keep).then(() => {
          if (keep) void loadFile(keep)
        })
      }
    })
  }, [activeProduct, activePath, refreshMeta, loadFile])

  const selectFile = (path: string) => {
    if (dirty && !window.confirm(t('skills.unsavedConfirm'))) return
    setActivePath(path)
    loadedRef.current = ''
  }

  const saveCurrent = async () => {
    if (!activePath || saving) return
    setSaving(true)
    try {
      await api.saveAgentSkillFile(model.AgentSkillFileSaveDO.createFrom({ path: activePath, content }))
      setDirty(false)
      setStatusMessage(t('skills.saved'))
      await refreshMeta(activePath)
      await loadFile(activePath)
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (next: boolean) => {
    if (!activeSkillId) return
    try {
      await api.setAgentSkillEnabled(model.AgentSkillEnabledDO.createFrom({ id: activeSkillId, enabled: next }))
      setMetaById((prev) => ({
        ...prev,
        [activeSkillId]: { ...prev[activeSkillId], enabled: next },
      }))
      loadedRef.current = ''
      await loadFile(activePath)
      setStatusMessage(t('skills.saved'))
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteAgentSkill(deleteTarget.id)
      setDeleteTarget(null)
      setStatusMessage(t('skills.deleted'))
      loadedRef.current = ''
      setActivePath('')
      await refreshMeta()
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const tryInvoke = () => {
    if (!activeSkillId) return
    openAgentDraft({ mentions: [], skillIds: [activeSkillId] })
  }

  const createSkill = () => {
    openAgentDraft({
      mentions: [],
      message: '/skill-creator 新建技能（可在发送前补充 id、名称等要求）',
    })
  }

  useDismissOverlays(() => {})

  return (
    <div className="product-workbench skills-workbench">
      <header className="product-toolbar skills-toolbar">
        <div className="product-actions">
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" {...pressProps(createSkill)}>
            <IconPlus size={14} /> {t('skills.new')}
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void refreshMeta(activePath))}>
            <IconRefresh size={14} /> {t('skills.refresh')}
          </button>
          {activePath && (
            <>
              <button
                type="button"
                className="wn-btn wn-btn-sm wn-btn-tool"
                disabled={!dirty || saving}
                {...pressProps(() => void saveCurrent(), { disabled: !dirty || saving })}
              >
                <IconSave size={14} /> {saving ? t('common.saving') : t('skills.save')}
              </button>
              {activeSkillId && (
                <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(tryInvoke)}>
                  {t('skills.tryInvoke', { id: activeSkillId })}
                </button>
              )}
              {editingSkillMd && activeSkillId && (
                <label className="skills-toolbar-enabled">
                  <input
                    type="checkbox"
                    checked={activeMeta?.enabled ?? true}
                    onChange={(e) => void toggleEnabled(e.target.checked)}
                  />
                  {t('skills.enabled')}
                </label>
              )}
              {activeSkillId && activeSkillId !== PROTECTED_SKILL_ID && (
                <button
                  type="button"
                  className="wn-btn wn-btn-sm wn-btn-tool"
                  {...pressProps(() => activeMeta && setDeleteTarget(activeMeta))}
                >
                  <IconTrash size={14} />
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="product-body skills-body">
        <aside className="skills-sidebar">
          <div className="skills-sidebar-search">
            <input
              className="wn-input wn-input-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('skills.searchPlaceholder')}
            />
          </div>
          <div className="skills-sidebar-list">
            {loading && treeRefreshKey === 0 && <div className="empty-hint">{t('skills.loading')}</div>}
            <DirTree
              rootLabel={SKILLS_ROOT}
              listDir={listSkillsDir}
              activePath={activePath}
              onSelectFile={selectFile}
              filter={filter}
              refreshKey={treeRefreshKey}
            />
          </div>
        </aside>

        <main className="skills-main">
          {!activePath ? (
            <div className="pane-empty">{t('skills.pickFile')}</div>
          ) : (
            <>
              <div className="skills-editor-head">
                <div className="skills-editor-identity">
                  <span className="skills-editor-path">
                    {SKILLS_ROOT}/{activePath}
                  </span>
                  {editingSkillMd && <span className="skills-editor-hint">{t('skills.frontmatterHint')}</span>}
                </div>
                <span className={`skills-editor-save-state${dirty ? ' is-dirty' : ''}`} aria-hidden />
              </div>
              <div className="skills-editor">
                <NoteEditor
                  noteId={activePath}
                  language={activePath.endsWith('.md') ? 'markdown' : 'plaintext'}
                  content={content}
                  onChange={(v) => {
                    setContent(v)
                    setDirty(true)
                  }}
                />
              </div>
            </>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('skills.deleteTitle')}
        message={t('skills.deleteMsg', { id: deleteTarget?.id ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

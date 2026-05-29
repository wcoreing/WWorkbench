import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { EnvPreset, ProjectEnvHint, RuntimeInfo, RuntimeLang, RuntimeVersion } from '../../api/types'
import { IconLayers, IconPlus } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EnvPresetModal } from '../../features/environment/EnvPresetModal'
import { EnvVersionModal } from '../../features/environment/EnvVersionModal'
import { useAppStore } from '../../stores/appStore'

const RUNTIME_META: Record<RuntimeLang, { label: string; color: string }> = {
  node: { label: 'Node.js', color: '#3c873a' },
  go: { label: 'Go', color: '#00add8' },
  php: { label: 'PHP', color: '#777bb4' },
  java: { label: 'Java', color: '#e76f00' },
}

const LANGS: RuntimeLang[] = ['node', 'go', 'php', 'java']

/** EnvironmentWorkbench 本机开发环境管理。 */
export function EnvironmentWorkbench() {
  const { setStatusMessage } = useAppStore()
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([])
  const [presets, setPresets] = useState<EnvPreset[]>([])
  const [projects, setProjects] = useState<ProjectEnvHint[]>([])
  const [scanPath, setScanPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [presetModal, setPresetModal] = useState<EnvPreset | null | undefined>(undefined)
  const [switchLang, setSwitchLang] = useState<RuntimeLang | null>(null)
  const [versions, setVersions] = useState<RuntimeVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const versionRequestRef = useRef(0)
  const versionCacheRef = useRef<Partial<Record<RuntimeLang, RuntimeVersion[]>>>({})
  const [deletePreset, setDeletePreset] = useState<EnvPreset | null>(null)

  const activePreset = useMemo(() => presets.find((p) => p.active) ?? null, [presets])
  const runtimeMap = useMemo(() => Object.fromEntries(runtimes.map((r) => [r.lang, r])), [runtimes])

  const refreshRuntimes = useCallback(async () => {
    const list = await api.listEnvRuntimes()
    setRuntimes(list as RuntimeInfo[])
  }, [])

  const refreshPresets = useCallback(async () => {
    setPresets(await api.listEnvPresets())
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([refreshRuntimes(), refreshPresets()])
      const path = await api.getEnvScanPath()
      setScanPath(path)
      if (path) {
        setProjects(await api.scanEnvProjects(path))
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [refreshRuntimes, refreshPresets, setStatusMessage])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  /** loadVersions 加载某语言版本列表（默认读缓存，force 时强制请求）。 */
  const loadVersions = useCallback(
    async (lang: RuntimeLang, opts?: { force?: boolean; silent?: boolean }) => {
      const cached = versionCacheRef.current[lang]
      if (cached && !opts?.force) {
        setVersions(cached)
        return
      }

      const reqId = ++versionRequestRef.current
      if (!opts?.silent) {
        setVersions(cached ?? [])
        setVersionsLoading(true)
      }
      try {
        const list = await api.listEnvVersions(lang)
        if (reqId !== versionRequestRef.current) return
        versionCacheRef.current[lang] = list
        setVersions(list)
      } catch (e) {
        if (reqId !== versionRequestRef.current) return
        setStatusMessage((e as Error).message)
      } finally {
        if (reqId === versionRequestRef.current && !opts?.silent) {
          setVersionsLoading(false)
        }
      }
    },
    [setStatusMessage],
  )

  const openSwitch = (lang: RuntimeLang) => {
    setSwitchLang(lang)
    void loadVersions(lang)
  }

  const closeVersionModal = () => {
    versionRequestRef.current += 1
    setSwitchLang(null)
    setVersions([])
    setVersionsLoading(false)
  }

  const refreshVersionModal = async (opts?: { silent?: boolean; force?: boolean }) => {
    if (!switchLang) return
    await loadVersions(switchLang, { force: opts?.force !== false, silent: opts?.silent })
    await refreshRuntimes()
  }

  const applyPreset = async (preset: EnvPreset) => {
    setLoading(true)
    try {
      const result = await api.applyEnvPreset(preset.id)
      await refreshAll()
      if (result.warnings?.length) {
        setStatusMessage(`预设已应用，部分项未成功：${result.warnings.join('；')}`)
      } else {
        setStatusMessage(`已应用预设「${preset.name}」`)
      }
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const pickScanDir = async () => {
    try {
      const path = await api.pickEnvScanDirectory()
      if (!path) return
      setScanPath(path)
      setProjects(await api.scanEnvProjects(path))
      setStatusMessage(`已扫描 ${path}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    }
  }

  const alignProject = async (proj: ProjectEnvHint) => {
    setLoading(true)
    try {
      const warnings: string[] = []
      for (const [lang, ver] of Object.entries(proj.suggested)) {
        try {
          await api.ensureEnvVersion(lang, ver)
        } catch (e) {
          warnings.push(`${lang}: ${(e as Error).message}`)
        }
      }
      await refreshRuntimes()
      setStatusMessage(warnings.length ? `部分对齐失败：${warnings.join('；')}` : `已对齐 ${proj.path}`)
    } catch (e) {
      setStatusMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const versionPrefixMatch = (current: string | undefined, target: string | undefined) => {
    if (!current || !target) return false
    const curParts = current.split('.')
    const tgtParts = target.split('.')
    return curParts[0] === tgtParts[0] && curParts[1] === tgtParts[1]
  }

  return (
    <div className="product-workbench toolchain-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" onClick={() => setPresetModal(null)}>
            <IconPlus size={13} />
            <span>新建预设</span>
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" onClick={() => void pickScanDir()} disabled={loading}>
            选择扫描目录
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-chrome"
            onClick={() => scanPath && void api.scanEnvProjects(scanPath).then(setProjects)}
            disabled={loading || !scanPath}
          >
            重新扫描
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-toolbar-status">{loading ? '加载中…' : scanPath || '未选择扫描目录'}</span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar toolchain-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>版本预设</span>
              <button
                type="button"
                className="wn-btn wn-btn-icon wn-btn-sm"
                onClick={() => setPresetModal(null)}
                title="新建"
              >
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              {presets.length === 0 ? (
                <div className="empty-hint">创建预设以一键切换多语言版本</div>
              ) : (
                <ul className="toolchain-preset-list">
                  {presets.map((p) => (
                    <li
                      key={p.id}
                      className={`toolchain-preset-item ${p.active ? 'active' : ''}`}
                      onClick={() => void applyPreset(p)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setPresetModal(p)
                      }}
                    >
                      <span className="toolchain-preset-name">{p.name}</span>
                      <span className="toolchain-preset-meta">
                        {Object.entries(p.runtimes)
                          .filter(([, v]) => v)
                          .map(([k, v]) => `${k} ${v}`)
                          .join(' · ') || '未配置版本'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        <main className="toolchain-main">
          <section className="toolchain-section">
            <header className="toolchain-section-header">
              <IconLayers size={16} />
              <div>
                <h2>当前生效</h2>
                <p>通过 nvm / goenv / brew / sdkman 检测与切换本机版本</p>
              </div>
            </header>
            <div className="toolchain-runtime-grid">
              {LANGS.map((lang) => {
                const r = runtimeMap[lang]
                const meta = RUNTIME_META[lang]
                return (
                  <article key={lang} className="toolchain-runtime-card">
                    <div className="toolchain-runtime-head">
                      <span className="toolchain-lang-badge" style={{ background: meta.color }}>
                        {lang}
                      </span>
                      <span className="toolchain-runtime-label">{meta.label}</span>
                      <button
                        type="button"
                        className="wn-btn wn-btn-sm wn-btn-ghost"
                        onClick={() => openSwitch(lang)}
                      >
                        管理
                      </button>
                    </div>
                    <div className="toolchain-runtime-version">{r?.available ? r.version : '未检测到'}</div>
                    <div className="toolchain-runtime-meta">
                      <span>via {r?.managerLabel || r?.manager || '—'}</span>
                      {r?.needsManager && r?.canInstallManager && !r?.canInstall && (
                        <span className="toolchain-runtime-warn">需安装 {r.managerLabel}</span>
                      )}
                    </div>
                    <div className="toolchain-runtime-path" title={r?.binary}>
                      {r?.binary || '—'}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          {activePreset && (
            <section className="toolchain-section">
              <header className="toolchain-section-header compact">
                <h3>预设「{activePreset.name}」</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => setPresetModal(activePreset)}>
                    编辑
                  </button>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" onClick={() => setDeletePreset(activePreset)}>
                    删除
                  </button>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={() => void applyPreset(activePreset)}>
                    一键应用
                  </button>
                </div>
              </header>
              <table className="toolchain-table">
                <thead>
                  <tr>
                    <th>语言</th>
                    <th>预设版本</th>
                    <th>当前版本</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {LANGS.map((lang) => {
                    const presetVer = activePreset.runtimes[lang]
                    const current = runtimeMap[lang]?.version
                    const matched = versionPrefixMatch(current, presetVer)
                    return (
                      <tr key={lang}>
                        <td>
                          <span className="toolchain-lang-dot" style={{ background: RUNTIME_META[lang].color }} />
                          {RUNTIME_META[lang].label}
                        </td>
                        <td className="toolchain-mono">{presetVer ?? '—'}</td>
                        <td className="toolchain-mono">{current ?? '—'}</td>
                        <td>
                          {!presetVer ? (
                            <span className="toolchain-status toolchain-status-skip">未配置</span>
                          ) : matched ? (
                            <span className="toolchain-status toolchain-status-ok">已对齐</span>
                          ) : (
                            <span className="toolchain-status toolchain-status-warn">需切换</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section className="toolchain-section">
            <header className="toolchain-section-header compact">
              <h3>项目检测</h3>
              <span className="toolchain-hint">读取 .nvmrc、go.mod、.php-version、.java-version</span>
            </header>
            {projects.length === 0 ? (
              <div className="pane-empty">选择目录后扫描子项目</div>
            ) : (
              <div className="toolchain-project-list">
                {projects.map((proj) => (
                  <article key={proj.path} className="toolchain-project-card">
                    <div className="toolchain-project-path">{proj.path}</div>
                    <div className="toolchain-project-hints">
                      {proj.hints.map((h) => (
                        <span key={h} className="toolchain-hint-tag">
                          {h}
                        </span>
                      ))}
                    </div>
                    <div className="toolchain-project-suggest">
                      建议：
                      {Object.entries(proj.suggested)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(' · ') || '—'}
                    </div>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" onClick={() => void alignProject(proj)}>
                      对齐版本
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      <EnvPresetModal
        open={presetModal !== undefined}
        initial={presetModal || undefined}
        onClose={() => setPresetModal(undefined)}
        onSaved={() => void refreshPresets()}
      />

      <EnvVersionModal
        key={switchLang ?? 'closed'}
        open={switchLang != null}
        lang={switchLang}
        runtime={switchLang ? runtimeMap[switchLang] : undefined}
        versions={versions}
        loading={versionsLoading}
        onClose={closeVersionModal}
        onRefresh={refreshVersionModal}
        onStatus={setStatusMessage}
      />

      <ConfirmDialog
        open={deletePreset != null}
        title="删除环境预设"
        message={deletePreset ? `确定删除「${deletePreset.name}」？` : undefined}
        confirmLabel="删除"
        danger
        onConfirm={() => {
          const p = deletePreset
          setDeletePreset(null)
          if (!p) return
          void api.deleteEnvPreset(p.id).then(() => refreshPresets())
        }}
        onCancel={() => setDeletePreset(null)}
      />
    </div>
  )
}

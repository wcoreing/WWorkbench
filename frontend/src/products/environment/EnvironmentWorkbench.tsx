import { IconLayers, IconPlus } from '../../components/Icons'

/** 运行时语言 */
type RuntimeLang = 'node' | 'go' | 'php' | 'java'

interface RuntimeRow {
  lang: RuntimeLang
  label: string
  version: string
  manager: string
  binary: string
}

interface ToolchainPreset {
  id: string
  name: string
  active?: boolean
  runtimes: Partial<Record<RuntimeLang, string>>
}

interface ProjectHint {
  id: string
  path: string
  hints: string[]
  suggested: Partial<Record<RuntimeLang, string>>
}

const RUNTIME_META: Record<RuntimeLang, { label: string; color: string }> = {
  node: { label: 'Node.js', color: '#3c873a' },
  go: { label: 'Go', color: '#00add8' },
  php: { label: 'PHP', color: '#777bb4' },
  java: { label: 'Java', color: '#e76f00' },
}

const MOCK_CURRENT: RuntimeRow[] = [
  { lang: 'node', label: 'Node.js', version: '20.11.0', manager: 'nvm', binary: '~/.nvm/versions/node/v20.11.0/bin/node' },
  { lang: 'go', label: 'Go', version: '1.22.3', manager: 'goenv', binary: '~/.goenv/versions/1.22.3/bin/go' },
  { lang: 'php', label: 'PHP', version: '8.3.6', manager: 'brew', binary: '/opt/homebrew/bin/php' },
  { lang: 'java', label: 'Java', version: '17.0.11', manager: 'sdkman', binary: '~/.sdkman/candidates/java/17.0.11-tem/bin/java' },
]

const MOCK_PRESETS: ToolchainPreset[] = [
  {
    id: 'fullstack',
    name: '全栈项目',
    active: true,
    runtimes: { node: '18.20.4', go: '1.21.8', php: '8.2.20', java: '17.0.11' },
  },
  {
    id: 'api',
    name: 'API 微服务',
    runtimes: { node: '20.11.0', go: '1.22.3', java: '21.0.3' },
  },
  {
    id: 'legacy',
    name: 'Legacy 维护',
    runtimes: { node: '16.20.2', php: '7.4.33', java: '8.0.392' },
  },
]

const MOCK_PROJECTS: ProjectHint[] = [
  {
    id: '1',
    path: '~/workspace/api-server',
    hints: ['.nvmrc → 18', 'go.mod → 1.22'],
    suggested: { node: '18.20.4', go: '1.22.3' },
  },
  {
    id: '2',
    path: '~/workspace/admin-web',
    hints: ['package.json engines.node → 20', '.java-version → 17'],
    suggested: { node: '20.11.0', java: '17.0.11' },
  },
]

/** 本机开发语言版本管理（UI 原型） */
export function EnvironmentWorkbench() {
  const activePreset = MOCK_PRESETS.find((p) => p.active)

  return (
    <div className="product-workbench toolchain-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            <IconPlus size={13} />
            <span>新建预设</span>
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            扫描项目
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            应用预设
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-coming-tag">开发中</span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar toolchain-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>版本预设</span>
              <button type="button" className="wn-btn wn-btn-icon wn-btn-sm" disabled title="新建">
                <IconPlus size={14} />
              </button>
            </div>
            <div className="sidebar-body">
              <ul className="toolchain-preset-list">
                {MOCK_PRESETS.map((p) => (
                  <li key={p.id} className={`toolchain-preset-item ${p.active ? 'active' : ''}`}>
                    <span className="toolchain-preset-name">{p.name}</span>
                    <span className="toolchain-preset-meta">
                      {Object.entries(p.runtimes)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </aside>

        <main className="toolchain-main">
          <section className="toolchain-section">
            <header className="toolchain-section-header">
              <IconLayers size={16} />
              <div>
                <h2>当前生效</h2>
                <p>切换后对本应用内置终端与子进程生效</p>
              </div>
            </header>
            <div className="toolchain-runtime-grid">
              {MOCK_CURRENT.map((r) => (
                <article key={r.lang} className="toolchain-runtime-card">
                  <div className="toolchain-runtime-head">
                    <span className="toolchain-lang-badge" style={{ background: RUNTIME_META[r.lang].color }}>
                      {r.lang}
                    </span>
                    <span className="toolchain-runtime-label">{RUNTIME_META[r.lang].label}</span>
                    <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" disabled>
                      切换
                    </button>
                  </div>
                  <div className="toolchain-runtime-version">{r.version}</div>
                  <div className="toolchain-runtime-meta">
                    <span>via {r.manager}</span>
                  </div>
                  <div className="toolchain-runtime-path" title={r.binary}>
                    {r.binary}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {activePreset && (
            <section className="toolchain-section">
              <header className="toolchain-section-header compact">
                <h3>预设「{activePreset.name}」</h3>
                <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" disabled>
                  一键应用
                </button>
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
                  {(['node', 'go', 'php', 'java'] as RuntimeLang[]).map((lang) => {
                    const presetVer = activePreset.runtimes[lang]
                    const current = MOCK_CURRENT.find((r) => r.lang === lang)
                    const matched = presetVer && current?.version.startsWith(presetVer.split('.').slice(0, 2).join('.'))
                    return (
                      <tr key={lang}>
                        <td>
                          <span className="toolchain-lang-dot" style={{ background: RUNTIME_META[lang].color }} />
                          {RUNTIME_META[lang].label}
                        </td>
                        <td className="toolchain-mono">{presetVer ?? '—'}</td>
                        <td className="toolchain-mono">{current?.version ?? '—'}</td>
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
              <span className="toolchain-hint">读取 .nvmrc、go.mod、.php-version、.java-version 等</span>
            </header>
            <div className="toolchain-project-list">
              {MOCK_PROJECTS.map((proj) => (
                <article key={proj.id} className="toolchain-project-card">
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
                      .join(' · ')}
                  </div>
                  <button type="button" className="wn-btn wn-btn-sm wn-btn-ghost" disabled>
                    对齐版本
                  </button>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

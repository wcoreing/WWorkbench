import { IconDocker, IconPlus } from '../../components/Icons'

const MOCK_CONTEXTS = [
  { id: 'local', name: '本地 Docker', endpoint: 'unix:///var/run/docker.sock' },
  { id: 'remote', name: 'dev-server', endpoint: 'ssh://deploy@192.168.1.10' },
]

const MOCK_CONTAINERS = [
  { id: 'a1', name: 'app-api', image: 'app-api:1.2.0', status: 'running', ports: '8080→8080', uptime: '2d' },
  { id: 'b2', name: 'mysql', image: 'mysql:8.0', status: 'running', ports: '3306→3306', uptime: '5d' },
  { id: 'c3', name: 'redis', image: 'redis:7-alpine', status: 'exited', ports: '-', uptime: '-' },
]

const MOCK_LOGS = `2026-05-29T02:15:01Z app-api  | Server listening on :8080
2026-05-29T02:15:02Z app-api  | Connected to mysql:3306
2026-05-29T02:18:44Z app-api  | GET /health 200 2ms
2026-05-29T02:22:10Z app-api  | GET /api/users 200 18ms`

/** Docker 产品线工作区（UI 原型） */
export function DockerWorkbench() {
  return (
    <div className="product-workbench docker-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            <IconPlus size={13} />
            <span>连接</span>
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            拉取镜像
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            启动
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            停止
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            日志
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-coming-tag">开发中</span>
      </div>

      <div className="product-body">
        <aside className="app-sidebar docker-sidebar">
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>Docker 上下文</span>
            </div>
            <div className="sidebar-body">
              <ul className="conn-list mock-list">
                {MOCK_CONTEXTS.map((ctx, i) => (
                  <li key={ctx.id} className={`conn-item mock-item ${i === 0 ? 'active' : ''}`}>
                    <IconDocker size={14} className="mock-icon" />
                    <div className="conn-meta">
                      <span className="conn-name">{ctx.name}</span>
                      <span className="conn-host">{ctx.endpoint}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="sidebar-section">
            <div className="sidebar-header">
              <span>视图</span>
            </div>
            <div className="sidebar-body docker-views">
              <button type="button" className="docker-view-btn active">容器</button>
              <button type="button" className="docker-view-btn" disabled>镜像</button>
              <button type="button" className="docker-view-btn" disabled>Compose</button>
              <button type="button" className="docker-view-btn" disabled>卷</button>
            </div>
          </section>
        </aside>

        <main className="app-main docker-main">
          <div className="editor-chrome">
            <div className="wn-tabs">
              <button type="button" className="wn-tab wn-tab-docker active">
                <span className="tab-dot" />
                <span className="tab-title">容器</span>
              </button>
              <button type="button" className="wn-tab wn-tab-add" disabled>
                +
              </button>
            </div>
          </div>

          <div className="docker-layout">
            <div className="docker-table-wrap">
              <table className="docker-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>镜像</th>
                    <th>状态</th>
                    <th>端口</th>
                    <th>运行时长</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_CONTAINERS.map((c, i) => (
                    <tr key={c.id} className={`docker-row ${i === 0 ? 'selected' : ''}`}>
                      <td className="docker-name">{c.name}</td>
                      <td>{c.image}</td>
                      <td>
                        <span className={`docker-status docker-status-${c.status}`}>{c.status}</span>
                      </td>
                      <td className="docker-mono">{c.ports}</td>
                      <td>{c.uptime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="docker-log-panel">
              <header className="docker-log-header">
                <span>日志 · app-api</span>
              </header>
              <pre className="docker-log-body">{MOCK_LOGS}</pre>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

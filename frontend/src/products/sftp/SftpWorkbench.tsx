import { IconFolder, IconPlus } from '../../components/Icons'

const REMOTE_FILES = [
  { name: 'app', type: 'dir', size: '-', mtime: 'May 28 09:00' },
  { name: 'logs', type: 'dir', size: '-', mtime: 'May 29 08:00' },
  { name: 'deploy.sh', type: 'file', size: '2.1 KB', mtime: 'May 27 16:30' },
  { name: 'config.yml', type: 'file', size: '512 B', mtime: 'May 25 10:12' },
]

/** SFTP 产品线工作区（UI 原型） */
export function SftpWorkbench() {
  return (
    <div className="product-workbench sftp-workbench">
      <div className="product-toolbar">
        <nav className="product-actions">
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            <IconPlus size={13} />
            <span>连接</span>
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            上传
          </button>
          <button type="button" className="wn-btn wn-btn-chrome" disabled>
            下载
          </button>
        </nav>
        <span className="chrome-spacer" />
        <span className="product-coming-tag">开发中</span>
      </div>

      <div className="product-body sftp-panes">
        <section className="sftp-pane">
          <header className="sftp-pane-header">
            <span>本地</span>
            <span className="sftp-path">~/Downloads</span>
          </header>
          <div className="sftp-pane-body">
            <div className="empty-hint">本地文件列表</div>
          </div>
        </section>
        <div className="sftp-divider" />
        <section className="sftp-pane">
          <header className="sftp-pane-header">
            <span>远程</span>
            <span className="sftp-path">/var/www/app</span>
          </header>
          <div className="sftp-pane-body">
            <table className="sftp-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>大小</th>
                  <th>修改时间</th>
                </tr>
              </thead>
              <tbody>
                {REMOTE_FILES.map((f) => (
                  <tr key={f.name} className="sftp-row">
                    <td>
                      {f.type === 'dir' && <IconFolder size={13} className="sftp-icon-dir" />}
                      {f.name}
                    </td>
                    <td>{f.size}</td>
                    <td>{f.mtime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

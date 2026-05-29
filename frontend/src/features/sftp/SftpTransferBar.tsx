import { useEffect, useState } from 'react'
import { onSftpProgress, type SftpProgressEvent } from '../../api/sftpEvents'
import { formatBytes } from './sftpUtils'

/** SftpTransferBar 传输进度条 */
export function SftpTransferBar() {
  const [evt, setEvt] = useState<SftpProgressEvent | null>(null)

  useEffect(() => onSftpProgress(setEvt), [])

  useEffect(() => {
    if (evt?.state !== 'done') return
    const timer = setTimeout(() => setEvt(null), 2000)
    return () => clearTimeout(timer)
  }, [evt])

  if (!evt) return null

  if (evt.state === 'done') {
    return (
      <div className="sftp-transfer-bar done">
        <span>
          {evt.kind === 'upload' ? '上传完成' : '下载完成'}：{evt.name}
        </span>
      </div>
    )
  }

  if (evt.state === 'error') {
    return (
      <div className="sftp-transfer-bar error">
        <span>
          传输失败：{evt.name}
        </span>
      </div>
    )
  }

  const pct = evt.total > 0 ? Math.min(100, Math.round((evt.done / evt.total) * 100)) : 0

  return (
    <div className="sftp-transfer-bar running">
      <span className="sftp-transfer-label">
        {evt.kind === 'upload' ? '上传' : '下载'} {evt.name}
      </span>
      <div className="sftp-transfer-track">
        <div className="sftp-transfer-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="sftp-transfer-meta">
        {formatBytes(evt.done)} / {evt.total > 0 ? formatBytes(evt.total) : '—'}
      </span>
    </div>
  )
}

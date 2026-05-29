interface Props {
  canUpload: boolean
  canDownload: boolean
  transferring?: boolean
  localHint?: string
  remoteHint?: string
  onUpload: () => void
  onDownload: () => void
}

/** SftpTransferRail 双栏中间的传输操作区 */
export function SftpTransferRail({
  canUpload,
  canDownload,
  transferring = false,
  localHint,
  remoteHint,
  onUpload,
  onDownload,
}: Props) {
  return (
    <aside className="sftp-transfer-rail" aria-label="文件传输">
      <div className="sftp-transfer-rail-inner">
        <button
          type="button"
          className="sftp-transfer-btn upload"
          title={localHint ? `上传：${localHint}` : '将左侧选中项加入上传队列'}
          disabled={!canUpload}
          onClick={onUpload}
        >
          <span className="sftp-transfer-arrow">→</span>
          <span className="sftp-transfer-text">上传</span>
        </button>
        <p className="sftp-transfer-hint">本地 → 远程</p>
        <button
          type="button"
          className="sftp-transfer-btn download"
          title={remoteHint ? `下载：${remoteHint}` : '将右侧选中项加入下载队列'}
          disabled={!canDownload}
          onClick={onDownload}
        >
          <span className="sftp-transfer-arrow">←</span>
          <span className="sftp-transfer-text">下载</span>
        </button>
        <p className="sftp-transfer-hint">远程 → 本地</p>
        {transferring && <p className="sftp-transfer-hint active">传输中…</p>}
      </div>
    </aside>
  )
}

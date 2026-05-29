import { useCallback, useRef, useState } from 'react'
import type { SSHTrustConfirm } from '../../api/sshTrust'
import '../../components/ui.css'

interface TrustState {
  fingerprint?: string
  resolve: (trusted: boolean) => void
}

/** SSHTrustDialog SSH 主机密钥信任确认弹窗 */
function SSHTrustDialog({
  fingerprint,
  onTrust,
  onCancel,
}: {
  fingerprint?: string
  onTrust: () => void
  onCancel: () => void
}) {
  return (
    <div className="wn-modal-backdrop ssh-trust-backdrop" onClick={onCancel}>
      <div
        className="wn-modal wn-modal-compact ssh-trust-dialog"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="ssh-trust-title"
      >
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="ssh-trust-title" className="wn-modal-title">
              信任 SSH 主机密钥
            </h2>
            <span className="wn-modal-tag">安全</span>
          </div>
          <p className="wn-modal-desc">首次连接需确认服务器指纹，确认后将写入本地 known_hosts</p>
        </header>
        <div className="wn-modal-body">
          <p className="ssh-trust-text">检测到未知 SSH 主机密钥，是否信任并继续连接？</p>
          {fingerprint && <code className="ssh-trust-fingerprint">{fingerprint}</code>}
        </div>
        <footer className="wn-modal-footer">
          <button type="button" className="wn-btn wn-btn-tool" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="wn-btn wn-btn-sm wn-btn-primary" onClick={onTrust}>
            信任并继续
          </button>
        </footer>
      </div>
    </div>
  )
}

/** useSSHTrustConfirm 提供异步信任确认与弹窗节点。 */
export function useSSHTrustConfirm() {
  const [trustState, setTrustState] = useState<TrustState | null>(null)
  const resolverRef = useRef<((trusted: boolean) => void) | null>(null)

  /** confirmTrust 等待用户在弹窗中确认是否信任。 */
  const confirmTrust = useCallback<SSHTrustConfirm>((fingerprint) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setTrustState({ fingerprint, resolve })
    })
  }, [])

  const finish = (trusted: boolean) => {
    trustState?.resolve(trusted)
    resolverRef.current?.(trusted)
    resolverRef.current = null
    setTrustState(null)
  }

  const trustDialog = trustState ? (
    <SSHTrustDialog
      fingerprint={trustState.fingerprint}
      onTrust={() => finish(true)}
      onCancel={() => finish(false)}
    />
  ) : null

  return { confirmTrust, trustDialog }
}

import { IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { terminalBackground } from './TerminalPane'

interface Props {
  title: string
  status: 'connecting' | 'failed'
  error?: string
  opacity: number
  onRetry?: () => void
  onEdit?: () => void
}

/** TerminalTabStatusPane 标签页内连接中/失败状态。 */
export function TerminalTabStatusPane({ title, status, error, opacity, onRetry, onEdit }: Props) {
  const { t } = useI18n()
  return (
    <div
      className="pane-empty terminal-connect-empty terminal-tab-status-pane"
      style={{ backgroundColor: terminalBackground(opacity) }}
    >
      {status === 'connecting' ? (
        <>
          <span className="terminal-connect-spinner" aria-hidden />
          <p className="terminal-connect-title">{t('terminal.connecting', { name: title })}</p>
          <p className="terminal-connect-hint">{t('terminal.connectingHint')}</p>
        </>
      ) : (
        <>
          <p className="terminal-connect-title">{t('terminal.connectFailed', { name: title })}</p>
          {error && <p className="terminal-connect-error">{error}</p>}
          <p className="terminal-connect-hint">{t('terminal.connectFailedHint')}</p>
          <div className="terminal-connect-actions">
            {onRetry && (
              <button type="button" className="wn-btn wn-btn-chrome" onClick={onRetry}>
                <IconRefresh size={13} />
                <span>{t('terminal.reconnect')}</span>
              </button>
            )}
            {onEdit && (
              <button type="button" className="wn-btn wn-btn-chrome" onClick={onEdit}>
                <span>{t('common.edit')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

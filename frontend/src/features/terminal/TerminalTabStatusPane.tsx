import { IconRefresh } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { terminalBackground } from './TerminalPane'

interface Props {
  title: string
  status: 'connecting' | 'failed'
  error?: string
  onRetry?: () => void
  onEdit?: () => void
}

/** 连接中/失败遮罩：始终实底，避免终端玻璃透出桌面造成「双层」观感。 */
export function TerminalTabStatusPane({ title, status, error, onRetry, onEdit }: Props) {
  const { t } = useI18n()
  return (
    <div
      className="pane-empty terminal-connect-empty terminal-tab-status-pane"
      style={{ backgroundColor: terminalBackground(1) }}
    >
      {status === 'connecting' ? (
        <>
          <span className="terminal-connect-spinner" aria-hidden />
          <p className="terminal-connect-title">{t('terminal.connecting', { name: title })}</p>
        </>
      ) : (
        <>
          {error ? (
            <p className="terminal-connect-error">{error}</p>
          ) : (
            <p className="terminal-connect-title">{t('terminal.connectFailed', { name: title })}</p>
          )}
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

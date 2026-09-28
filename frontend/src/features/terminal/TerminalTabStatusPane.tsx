import { IconRefresh } from '../../components/Icons'
import { openAgentDraft } from '../agent/openAgentDraft'
import { useI18n } from '../../i18n'
import { useAgentStore } from '../../stores/agentStore'
import { pressProps } from '../../components/compat'
import { terminalBackground } from './TerminalPane'

interface Props {
  title: string
  status: 'connecting' | 'failed'
  error?: string
  hostKind?: 'local' | 'ssh' | 'docker'
  onRetry?: () => void
  onEdit?: () => void
}

/** 连接中/失败遮罩：始终实底，避免终端玻璃透出桌面造成「双层」观感。 */
export function TerminalTabStatusPane({ title, status, error, hostKind, onRetry, onEdit }: Props) {
  const { t } = useI18n()

  const askConnectHelp = () => {
    useAgentStore.getState().setChatMode('ask')
    openAgentDraft({
      mentions: [],
      message:
        hostKind === 'local'
          ? t('agent.draftConnectFailedLocal', { name: title })
          : t('agent.draftConnectFailed', { name: title, error: error?.trim() || t('terminal.connectFailed', { name: title }) }),
    })
  }

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
              <button type="button" className="wn-btn wn-btn-chrome" {...pressProps(onRetry)}>
                <IconRefresh size={13} />
                <span>{t('terminal.reconnect')}</span>
              </button>
            )}
            {onEdit && (
              <button type="button" className="wn-btn wn-btn-chrome" {...pressProps(onEdit)}>
                <span>{t('common.edit')}</span>
              </button>
            )}
            <button type="button" className="wn-btn wn-btn-ghost" {...pressProps(askConnectHelp)}>
              <span>{t('terminal.askAfterFailed')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

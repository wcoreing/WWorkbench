import { useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'
import { withSSHHostTrust } from '../../../api/sshTrust'
import type { ShellHost } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { TerminalPane } from '../../../features/terminal/TerminalPane'
import { useSSHTrustConfirm } from '../../../features/terminal/useSSHTrustConfirm'
import { useI18n } from '../../../i18n'
import { useAppStore } from '../../../stores/appStore'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** TerminalResourceSurface 嵌入式 SSH 终端（会话随窗关闭）。 */
export function TerminalResourceSurface({ window: win, active }: Props) {
  const { t } = useI18n()
  const opacity = useAppStore((s) => s.terminalOpacity)
  const { confirmTrust, trustDialog } = useSSHTrustConfirm()
  const [sessionId, setSessionId] = useState('')
  const [host, setHost] = useState<ShellHost | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef('')

  const closeSession = (sid: string) => {
    if (!sid) return
    void api.closeTerminal(sid).catch(() => {})
  }

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      const h = await api.getShellHost(win.resourceId)
      setHost(h)
      if (h.kind === 'docker' && h.running === false) {
        throw new Error(t('terminal.containerStoppedHint', { name: h.name }))
      }
      const open = () => api.openTerminal(h.id, 100, 28)
      const info =
        h.kind === 'docker'
          ? await open()
          : await withSSHHostTrust(h.host || '', h.port || 22, open, confirmTrust)
      closeSession(sessionRef.current)
      sessionRef.current = info.sessionId
      setSessionId(info.sessionId)
    } catch (e) {
      setError((e as Error).message)
      sessionRef.current = ''
      setSessionId('')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void connect()
    return () => {
      closeSession(sessionRef.current)
      sessionRef.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅按 resourceId 建连
  }, [win.resourceId])

  if (error) {
    return (
      <div className="rw-surface rw-surface-terminal">
        {trustDialog}
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[{ label: t('common.retry'), onPress: () => void connect(), primary: true }]}
        />
      </div>
    )
  }

  if (!sessionId || busy) {
    return (
      <div className="rw-surface rw-surface-terminal rw-surface-loading">
        {trustDialog}
        <span>{busy ? t('terminal.connecting', { name: win.title }) : t('shell.loadingProduct')}</span>
        {!busy ? (
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" {...pressProps(() => void connect())}>
            {t('common.retry')}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rw-surface rw-surface-terminal">
      {trustDialog}
      <TerminalPane
        sessionId={sessionId}
        hostId={host?.id || win.resourceId}
        active={active}
        focused={active}
        opacity={opacity}
      />
    </div>
  )
}

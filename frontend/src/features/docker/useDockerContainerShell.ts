import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DockerContainer } from '../../api/types'
import { openTerminal } from '../../stores/productLink'
import { withLoading } from '../../stores/loadingStore'

export type DockerDetailTab = 'logs' | 'env' | 'shell'

/** useDockerContainerShell 管理 Docker 底部内嵌容器终端会话。 */
export function useDockerContainerShell(opts: {
  activeContextId: string
  detailTab: DockerDetailTab
  setDetailTab: (tab: DockerDetailTab) => void
  setStatusMessage: (msg: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const { activeContextId, detailTab, setDetailTab, setStatusMessage, t } = opts
  const [shellSessionId, setShellSessionId] = useState<string | null>(null)
  const [shellContainerId, setShellContainerId] = useState<string | null>(null)
  const [shellError, setShellError] = useState('')
  const shellSessionRef = useRef<string | null>(null)
  const shellContainerIdRef = useRef<string | null>(null)

  const closeShellSession = useCallback(async () => {
    const sid = shellSessionRef.current
    shellSessionRef.current = null
    shellContainerIdRef.current = null
    setShellContainerId(null)
    setShellSessionId(null)
    setShellError('')
    if (!sid) return
    try {
      await api.closeTerminal(sid)
    } catch {
      /* ignore */
    }
  }, [])

  const openContainerShell = useCallback(
    async (container: DockerContainer, openOpts?: { showTab?: boolean }) => {
      if (container.state !== 'running') return
      if (openOpts?.showTab !== false) setDetailTab('shell')
      if (shellContainerIdRef.current === container.id && shellSessionRef.current) return
      const loadingKey = `docker.shell.${container.id}`
      await withLoading(
        loadingKey,
        async () => {
          setStatusMessage(t('docker.preparingShell'))
          await closeShellSession()
          try {
            const host = await api.ensureDockerHost(activeContextId, container.id)
            const info = await api.openTerminal(host.id, 120, 32)
            shellSessionRef.current = info.sessionId
            shellContainerIdRef.current = container.id
            setShellContainerId(container.id)
            setShellSessionId(info.sessionId)
            setStatusMessage(t('docker.openingShell', { name: container.name || container.shortId }))
          } catch (e) {
            const message = (e as Error).message
            setShellError(message)
            setStatusMessage(message)
          }
        },
        {
          label: t('docker.preparingShell'),
          onBegin: () => {
            setShellError('')
            setShellSessionId(null)
          },
        },
      )
    },
    [activeContextId, closeShellSession, setDetailTab, setStatusMessage, t],
  )

  const popOutContainerShell = useCallback(
    async (container: DockerContainer) => {
      try {
        const host = await api.ensureDockerHost(activeContextId, container.id)
        openTerminal({ hostId: host.id }, 'docker')
      } catch (e) {
        setStatusMessage((e as Error).message)
      }
    },
    [activeContextId, setStatusMessage],
  )

  useEffect(() => {
    if (detailTab !== 'shell') {
      void closeShellSession()
    }
  }, [detailTab, closeShellSession])

  useEffect(
    () => () => {
      void closeShellSession()
    },
    [closeShellSession],
  )

  const shellLoadingKey = shellContainerId ? `docker.shell.${shellContainerId}` : 'docker.shell._'

  return {
    shellSessionId,
    shellLoadingKey,
    shellError,
    openContainerShell,
    popOutContainerShell,
  }
}

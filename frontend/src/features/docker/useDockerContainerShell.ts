import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DockerContainer } from '../../api/types'
import { openTerminal } from '../../stores/productLink'
import { withLoading } from '../../stores/loadingStore'

export type DockerDetailTab = 'logs' | 'env' | 'shell'

export type DockerShellSession = {
  sessionId: string
  containerId: string
  name: string
}

/** useDockerContainerShell 管理 Docker 底部内嵌多路容器终端（按 containerId 常驻，切 Tab/容器不杀会话）。 */
export function useDockerContainerShell(opts: {
  activeContextId: string
  setDetailTab: (tab: DockerDetailTab) => void
  setStatusMessage: (msg: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const { activeContextId, setDetailTab, setStatusMessage, t } = opts
  const [shellSessions, setShellSessions] = useState<Record<string, DockerShellSession>>({})
  const [shellErrors, setShellErrors] = useState<Record<string, string>>({})
  const sessionsRef = useRef(shellSessions)
  sessionsRef.current = shellSessions

  const closeShellSession = useCallback(async (containerId: string) => {
    const entry = sessionsRef.current[containerId]
    setShellSessions((prev) => {
      if (!(containerId in prev)) return prev
      const next = { ...prev }
      delete next[containerId]
      return next
    })
    setShellErrors((prev) => {
      if (!(containerId in prev)) return prev
      const next = { ...prev }
      delete next[containerId]
      return next
    })
    if (!entry) return
    try {
      await api.closeTerminal(entry.sessionId)
    } catch {
      /* ignore */
    }
  }, [])

  const closeAllShellSessions = useCallback(async () => {
    const ids = Object.keys(sessionsRef.current)
    if (ids.length === 0) {
      setShellErrors({})
      return
    }
    const closing = Object.values(sessionsRef.current)
    sessionsRef.current = {}
    setShellSessions({})
    setShellErrors({})
    await Promise.all(
      closing.map((entry) =>
        api.closeTerminal(entry.sessionId).catch(() => {
          /* ignore */
        }),
      ),
    )
  }, [])

  const openContainerShell = useCallback(
    async (container: DockerContainer, openOpts?: { showTab?: boolean }) => {
      if (container.state !== 'running') return
      if (openOpts?.showTab !== false) setDetailTab('shell')
      if (sessionsRef.current[container.id]) return
      const loadingKey = `docker.shell.${container.id}`
      await withLoading(
        loadingKey,
        async () => {
          setStatusMessage(t('docker.preparingShell'))
          try {
            const host = await api.ensureDockerHost(activeContextId, container.id)
            const info = await api.openTerminal(host.id, 120, 32)
            const name = container.name || container.shortId
            setShellSessions((prev) => ({
              ...prev,
              [container.id]: { sessionId: info.sessionId, containerId: container.id, name },
            }))
            setStatusMessage(t('docker.openingShell', { name }))
          } catch (e) {
            const message = (e as Error).message
            setShellErrors((prev) => ({ ...prev, [container.id]: message }))
            setStatusMessage(message)
          }
        },
        {
          label: t('docker.preparingShell'),
          onBegin: () => {
            setShellErrors((prev) => {
              if (!(container.id in prev)) return prev
              const next = { ...prev }
              delete next[container.id]
              return next
            })
          },
        },
      )
    },
    [activeContextId, setDetailTab, setStatusMessage, t],
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

  /** 容器已停/删除时收掉对应会话，避免幽灵终端。 */
  const pruneShellSessions = useCallback(
    (aliveRunningIds: Iterable<string>) => {
      const alive = new Set(aliveRunningIds)
      for (const id of Object.keys(sessionsRef.current)) {
        if (!alive.has(id)) void closeShellSession(id)
      }
    },
    [closeShellSession],
  )

  // 切换 Docker 上下文或卸载时关掉全部内嵌会话
  useEffect(() => {
    return () => {
      void closeAllShellSessions()
    }
  }, [activeContextId, closeAllShellSessions])

  return {
    shellSessions,
    shellErrors,
    openContainerShell,
    popOutContainerShell,
    closeShellSession,
    pruneShellSessions,
  }
}

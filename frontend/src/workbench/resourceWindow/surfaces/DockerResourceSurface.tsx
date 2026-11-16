import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client'
import type { DockerContainer, DockerContext } from '../../../api/types'
import { EmptyState } from '../../../components/EmptyState'
import { pressProps } from '../../../components/compat'
import { useI18n } from '../../../i18n'
import { openAsProduct } from '../openResource'
import type { ResourceWindow } from '../types'

type Props = {
  window: ResourceWindow
  active: boolean
}

/** DockerResourceSurface 嵌入式 Docker 上下文：列容器、启停。 */
export function DockerResourceSurface({ window: win }: Props) {
  const { t } = useI18n()
  const [ctx, setCtx] = useState<DockerContext | null>(null)
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actingId, setActingId] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const list = await api.listDockerContexts()
      const hit = list.find((c) => c.id === win.resourceId)
      if (!hit) throw new Error(t('resourceWindow.dockerMissing'))
      setCtx(hit)
      const cs = (await api.listContainers(hit.id)) as DockerContainer[]
      setContainers(cs)
    } catch (e) {
      setError((e as Error).message)
      setContainers([])
    } finally {
      setBusy(false)
    }
  }, [t, win.resourceId])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (containerId: string, op: 'start' | 'stop' | 'restart') => {
    if (!ctx) return
    setActingId(containerId)
    setError('')
    try {
      if (op === 'start') await api.startContainer(ctx.id, containerId)
      else if (op === 'stop') await api.stopContainer(ctx.id, containerId)
      else await api.restartContainer(ctx.id, containerId)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActingId('')
    }
  }

  if (error && !ctx) {
    return (
      <div className="rw-surface rw-surface-docker">
        <EmptyState
          variant="inline"
          title={t('resourceWindow.connectFailed')}
          hint={error}
          actions={[
            { label: t('common.retry'), onPress: () => void load(), primary: true },
            {
              label: t('resourceWindow.openInProduct'),
              onPress: () => openAsProduct({ kind: 'docker', resourceId: win.resourceId, title: win.title }),
            },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="rw-surface rw-surface-docker">
      <div className="rw-surface-toolbar">
        <span className="rw-surface-meta" title={ctx?.endpoint || ''}>
          {ctx ? `${ctx.name} · ${ctx.kind}${ctx.connected ? '' : ` · ${t('resourceWindow.dockerOffline')}`}` : win.title}
        </span>
        <div className="rw-surface-toolbar-right">
          <button type="button" className="wn-btn wn-btn-sm wn-btn-tool" disabled={busy} {...pressProps(() => void load())}>
            {t('common.refresh')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-sm wn-btn-tool"
            {...pressProps(() =>
              openAsProduct({ kind: 'docker', resourceId: win.resourceId, title: win.title }),
            )}
          >
            {t('resourceWindow.openInProduct')}
          </button>
        </div>
      </div>
      {error ? <p className="rw-surface-error">{error}</p> : null}
      <ul className="rw-docker-list">
        {containers.length === 0 ? (
          <li className="rw-surface-muted">{busy ? t('shell.loadingProduct') : t('resourceWindow.dockerEmpty')}</li>
        ) : (
          containers.map((c) => {
            const running = /running/i.test(c.state || '')
            return (
              <li key={c.id} className="rw-docker-row">
                <div className="rw-docker-main">
                  <span className="rw-docker-name" title={c.name}>
                    {c.name || c.shortId}
                  </span>
                  <span className="rw-docker-sub">
                    {c.state} · {c.image}
                  </span>
                </div>
                <div className="rw-docker-actions">
                  {running ? (
                    <button
                      type="button"
                      className="wn-btn wn-btn-sm wn-btn-tool"
                      disabled={actingId === c.id}
                      {...pressProps(() => void act(c.id, 'stop'))}
                    >
                      {t('resourceWindow.dockerStop')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="wn-btn wn-btn-sm wn-btn-tool"
                      disabled={actingId === c.id}
                      {...pressProps(() => void act(c.id, 'start'))}
                    >
                      {t('resourceWindow.dockerStart')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="wn-btn wn-btn-sm wn-btn-tool"
                    disabled={actingId === c.id}
                    {...pressProps(() => void act(c.id, 'restart'))}
                  >
                    {t('resourceWindow.dockerRestart')}
                  </button>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

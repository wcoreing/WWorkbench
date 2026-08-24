import { useEffect, useMemo, useState } from 'react'
import type { ContainerMount, ContainerPortMapping, DockerContainer } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import { ModalPortal, Select, pressProps } from '../../components/compat'
import '../../components/ui.css'

interface Props {
  open: boolean
  contextId: string
  container: DockerContainer | null
  onClose: () => void
  onUpdated: (container: DockerContainer) => void
}

interface PortRow {
  hostPort: string
  containerPort: string
  protocol: string
}

interface MountRow {
  type: string
  name: string
  source: string
  destination: string
  rw: boolean
}

/** parsePort 解析正整数端口。 */
function parsePort(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(n) ? n : 0
}

/** toPortRows 初始化端口编辑行。 */
function toPortRows(ports?: ContainerPortMapping[]): PortRow[] {
  if (!ports?.length) return [{ hostPort: '', containerPort: '', protocol: 'tcp' }]
  return ports.map((p) => ({
    hostPort: p.hostPort > 0 ? String(p.hostPort) : '',
    containerPort: String(p.containerPort || ''),
    protocol: p.protocol || 'tcp',
  }))
}

/** toMountRows 初始化挂载编辑行。 */
function toMountRows(mounts?: ContainerMount[]): MountRow[] {
  if (!mounts?.length) return []
  return mounts.map((m) => ({
    type: m.type || 'bind',
    name: m.name || '',
    source: m.type === 'volume' ? m.name || m.source : m.source,
    destination: m.destination,
    rw: m.rw !== false,
  }))
}

/** DockerContainerEditModal 编辑端口映射与挂载（重建容器生效）。 */
export function DockerContainerEditModal({ open, contextId, container, onClose, onUpdated }: Props) {
  const { t } = useI18n()
  const [ports, setPorts] = useState<PortRow[]>([])
  const [mounts, setMounts] = useState<MountRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const typeOptions = useMemo(
    () => [
      { value: 'bind', label: t('docker.editModal.typeBind') },
      { value: 'volume', label: t('docker.editModal.typeVolume') },
    ],
    [t],
  )

  useEffect(() => {
    if (!open || !container) return
    setPorts(toPortRows(container.portMappings))
    setMounts(toMountRows(container.mounts))
    setError('')
    setSubmitting(false)
  }, [open, container])

  if (!open || !container) return null

  const updatePort = (index: number, patch: Partial<PortRow>) => {
    setPorts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const addPort = () => setPorts((prev) => [...prev, { hostPort: '', containerPort: '', protocol: 'tcp' }])
  const removePort = (index: number) => {
    setPorts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  const updateMount = (index: number, patch: Partial<MountRow>) => {
    setMounts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const addMount = () =>
    setMounts((prev) => [...prev, { type: 'bind', name: '', source: '', destination: '', rw: true }])
  const removeMount = (index: number) => setMounts((prev) => prev.filter((_, i) => i !== index))

  const submit = async () => {
    const portMappings = ports
      .map((row) => ({
        hostPort: parsePort(row.hostPort),
        containerPort: parsePort(row.containerPort),
        protocol: row.protocol.trim() || 'tcp',
      }))
      .filter((p) => p.containerPort > 0)

    for (const row of mounts) {
      if (!row.destination.trim()) {
        setError(t('docker.editModal.mountDestRequired'))
        return
      }
      if (!row.source.trim()) {
        setError(t('docker.editModal.mountSourceRequired'))
        return
      }
    }

    const update = new model.ContainerUpdateDO({
      ports: portMappings.map(
        (p) =>
          new model.ContainerPortMappingDO({
            hostPort: p.hostPort,
            containerPort: p.containerPort,
            protocol: p.protocol,
          }),
      ),
      mounts: mounts.map(
        (m) =>
          new model.ContainerMountDO({
            type: m.type,
            name: m.type === 'volume' ? m.source.trim() : m.name,
            source: m.source.trim(),
            destination: m.destination.trim(),
            mode: m.rw ? 'rw' : 'ro',
            rw: m.rw,
          }),
      ),
    })

    setSubmitting(true)
    setError('')
    try {
      const next = await api.updateContainerSpec(contextId, container.id, update)
      onUpdated(next)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalPortal>
      <div className="wn-modal-backdrop wn-modal-backdrop-top" {...pressProps(onClose)}>
        <div
          className="wn-modal docker-run-modal"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <header className="wn-modal-header">
            <h2 className="wn-modal-title">{t('docker.editModal.title')}</h2>
            <p className="wn-modal-desc">
              {t('docker.editModal.desc', { name: container.name || container.shortId })}
            </p>
          </header>
          <div className="wn-modal-body docker-run-body">
            <div className="wn-field">
              <label>{t('docker.editModal.portMapping')}</label>
              <div className="docker-run-ports">
                {ports.map((row, index) => (
                  <div key={`port-${index}`} className="docker-run-port-row">
                    <input
                      className="wn-input"
                      placeholder={t('docker.runModal.hostPort')}
                      value={row.hostPort}
                      onChange={(e) => updatePort(index, { hostPort: e.target.value })}
                      disabled={submitting}
                    />
                    <span className="docker-run-port-sep">→</span>
                    <input
                      className="wn-input"
                      placeholder={t('docker.runModal.containerPort')}
                      value={row.containerPort}
                      onChange={(e) => updatePort(index, { containerPort: e.target.value })}
                      disabled={submitting}
                    />
                    <Select
                      value={row.protocol}
                      options={[
                        { value: 'tcp', label: 'tcp' },
                        { value: 'udp', label: 'udp' },
                      ]}
                      onChange={(v) => updatePort(index, { protocol: v })}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className="wn-btn wn-btn-text-danger wn-btn-sm"
                      disabled={submitting || ports.length <= 1}
                      {...pressProps(() => removePort(index), { disabled: submitting || ports.length <= 1 })}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ))}
                <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" disabled={submitting} {...pressProps(addPort, { disabled: submitting })}>
                  {t('docker.runModal.addPort')}
                </button>
              </div>
            </div>

            <div className="wn-field">
              <label>{t('docker.editModal.mounts')}</label>
              <div className="docker-run-ports">
                {mounts.length === 0 ? (
                  <p className="docker-edit-empty">{t('docker.editModal.noMounts')}</p>
                ) : (
                  mounts.map((row, index) => (
                    <div key={`mount-${index}`} className="docker-run-port-row docker-edit-mount-row">
                      <Select
                        value={row.type}
                        options={typeOptions}
                        onChange={(v) => updateMount(index, { type: v })}
                        disabled={submitting}
                      />
                      <input
                        className="wn-input"
                        placeholder={
                          row.type === 'volume'
                            ? t('docker.editModal.volumeName')
                            : t('docker.editModal.hostPath')
                        }
                        value={row.source}
                        onChange={(e) => updateMount(index, { source: e.target.value })}
                        disabled={submitting}
                      />
                      <span className="docker-run-port-sep">→</span>
                      <input
                        className="wn-input"
                        placeholder={t('docker.editModal.containerPath')}
                        value={row.destination}
                        onChange={(e) => updateMount(index, { destination: e.target.value })}
                        disabled={submitting}
                      />
                      <label className="docker-edit-rw">
                        <input
                          type="checkbox"
                          checked={row.rw}
                          onChange={(e) => updateMount(index, { rw: e.target.checked })}
                          disabled={submitting}
                        />
                        rw
                      </label>
                      <button
                        type="button"
                        className="wn-btn wn-btn-text-danger wn-btn-sm"
                        disabled={submitting}
                        {...pressProps(() => removeMount(index), { disabled: submitting })}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  ))
                )}
                <button type="button" className="wn-btn wn-btn-tool wn-btn-sm" disabled={submitting} {...pressProps(addMount, { disabled: submitting })}>
                  {t('docker.editModal.addMount')}
                </button>
              </div>
            </div>

            {error && <p className="wn-form-error">{error}</p>}
          </div>
          <footer className="wn-modal-footer">
            <button type="button" className="wn-btn wn-btn-tool" disabled={submitting} {...pressProps(onClose, { disabled: submitting })}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="wn-btn wn-btn-primary"
              disabled={submitting}
              {...pressProps(() => void submit(), { disabled: submitting })}
            >
              {submitting ? t('docker.editModal.saving') : t('docker.editModal.submit')}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}

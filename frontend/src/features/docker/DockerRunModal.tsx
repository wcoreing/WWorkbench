import { useEffect, useMemo, useState } from 'react'
import type { DockerContainer } from '../../api/types'
import { api } from '../../api/client'
import { useI18n } from '../../i18n'
import { model } from '../../../wailsjs/go/models'
import '../../components/ui.css'
import { Select, pressProps } from '../../components/compat'

interface DockerRunModalProps {
  open: boolean
  contextId: string
  image: string
  onClose: () => void
  onCreated: (container: DockerContainer) => void
}

interface PortRow {
  hostPort: string
  containerPort: string
  protocol: string
}

interface EnvRow {
  key: string
  value: string
  placeholder: string
  required: boolean
  secret: boolean
}

/** primaryImageTag 取镜像第一个可用标签。 */
function primaryImageTag(tags: string): string {
  if (!tags || tags === '<none>') return ''
  return tags.split(',')[0]?.trim() || tags
}

/** toPortRows 将预设端口转为表单行。 */
function toPortRows(ports: model.ContainerPortMappingDO[]): PortRow[] {
  if (!ports?.length) {
    return [{ hostPort: '', containerPort: '', protocol: 'tcp' }]
  }
  return ports.map((p) => ({
    hostPort: String(p.hostPort || ''),
    containerPort: String(p.containerPort || ''),
    protocol: p.protocol || 'tcp',
  }))
}

/** toEnvRows 将预设环境变量转为表单行。 */
function toEnvRows(fields: model.ContainerRunEnvFieldDO[]): EnvRow[] {
  return (fields ?? []).map((f) => ({
    key: f.key,
    value: f.default || '',
    placeholder: f.placeholder || f.key,
    required: f.required,
    secret: f.secret,
  }))
}

/** parsePort 解析正整数端口。 */
function parsePort(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(n) ? n : 0
}

/** DockerRunModal 从镜像创建并运行容器。 */
export function DockerRunModal({ open, contextId, image, onClose, onCreated }: DockerRunModalProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [restart, setRestart] = useState('unless-stopped')
  const [autoStart, setAutoStart] = useState(true)
  const [ports, setPorts] = useState<PortRow[]>([{ hostPort: '', containerPort: '', protocol: 'tcp' }])
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [extraEnv, setExtraEnv] = useState<EnvRow[]>([])

  const restartOptions = useMemo(
    () => [
      { value: 'unless-stopped', label: 'unless-stopped' },
      { value: 'always', label: 'always' },
      { value: 'on-failure', label: 'on-failure' },
      { value: '', label: t('docker.runModal.noRestart') },
    ],
    [t]
  )

  useEffect(() => {
    if (!open || !image) return
    const tag = primaryImageTag(image)
    if (!tag) {
      setError(t('docker.runModal.noTag'))
      return
    }
    setError('')
    setLoading(true)
    void api
      .getContainerRunPreset(tag)
      .then((preset) => {
        setName(preset.name || '')
        setRestart(preset.restart || 'unless-stopped')
        setPorts(toPortRows(preset.ports))
        setEnvRows(toEnvRows(preset.envFields))
        setExtraEnv([])
        setAutoStart(true)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [open, image, t])

  if (!open) return null

  const tag = primaryImageTag(image)

  const updatePort = (index: number, patch: Partial<PortRow>) => {
    setPorts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const addPort = () => {
    setPorts((prev) => [...prev, { hostPort: '', containerPort: '', protocol: 'tcp' }])
  }

  const removePort = (index: number) => {
    setPorts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  const updateEnv = (index: number, value: string) => {
    setEnvRows((prev) => prev.map((row, i) => (i === index ? { ...row, value } : row)))
  }

  const updateExtraEnv = (index: number, patch: Partial<EnvRow>) => {
    setExtraEnv((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const addExtraEnv = () => {
    setExtraEnv((prev) => [
      ...prev,
      { key: '', value: '', placeholder: 'KEY', required: false, secret: false },
    ])
  }

  const removeExtraEnv = (index: number) => {
    setExtraEnv((prev) => prev.filter((_, i) => i !== index))
  }

  const submit = async () => {
    if (!tag) {
      setError(t('docker.runModal.noTag'))
      return
    }
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('docker.runModal.nameRequired'))
      return
    }
    for (const row of envRows) {
      if (row.required && !row.value.trim()) {
        setError(t('docker.runModal.envRequired', { key: row.key }))
        return
      }
    }

    const portMappings = ports
      .map((row) => ({
        hostPort: parsePort(row.hostPort),
        containerPort: parsePort(row.containerPort),
        protocol: row.protocol.trim() || 'tcp',
      }))
      .filter((p) => p.containerPort > 0)

    const env: model.ContainerEnvKVDO[] = []
    for (const row of envRows) {
      if (!row.key.trim()) continue
      env.push(new model.ContainerEnvKVDO({ key: row.key.trim(), value: row.value }))
    }
    for (const row of extraEnv) {
      const key = row.key.trim()
      if (!key) continue
      env.push(new model.ContainerEnvKVDO({ key, value: row.value }))
    }

    const spec = new model.ContainerRunDO({
      image: tag,
      name: trimmedName,
      ports: portMappings.map(
        (p) =>
          new model.ContainerPortMappingDO({
            hostPort: p.hostPort,
            containerPort: p.containerPort,
            protocol: p.protocol,
          })
      ),
      env,
      restart: restart.trim(),
      autoStart,
    })

    setSubmitting(true)
    setError('')
    try {
      const container = await api.runContainer(contextId, spec)
      onCreated(container)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const busy = loading || submitting

  return (
    <div className="wn-modal-backdrop" {...pressProps(onClose)}>
      <div
        className="wn-modal docker-run-modal"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="docker-run-modal-title"
      >
        <header className="wn-modal-header">
          <div className="wn-modal-title-row">
            <h2 id="docker-run-modal-title" className="wn-modal-title">
              {t('docker.runModal.title')}
            </h2>
            <span className="wn-modal-tag">Docker</span>
          </div>
          <p className="wn-modal-desc docker-run-image" title={tag}>
            {t('docker.runModal.image', { image: tag || image })}
          </p>
        </header>

        <div className="wn-modal-body docker-run-body">
          {loading ? (
            <p className="docker-run-hint">{t('docker.runModal.loadingPreset')}</p>
          ) : (
            <div className="wn-form docker-run-form">
              <div className="wn-field">
                <label className="wn-label" htmlFor="docker-run-name">
                  {t('docker.runModal.name')}
                </label>
                <input
                  id="docker-run-name"
                  className="wn-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('docker.runModal.namePlaceholder')}
                  disabled={busy}
                />
              </div>

              <div className="wn-field">
                <span className="wn-label">{t('docker.runModal.portMapping')}</span>
                <div className="docker-run-ports">
                  {ports.map((row, index) => (
                    <div key={index} className="docker-run-port-row">
                      <input
                        className="wn-input docker-run-port-input"
                        type="number"
                        min={1}
                        max={65535}
                        placeholder={t('docker.runModal.hostPort')}
                        value={row.hostPort}
                        onChange={(e) => updatePort(index, { hostPort: e.target.value })}
                        disabled={busy}
                      />
                      <span className="docker-run-port-sep">→</span>
                      <input
                        className="wn-input docker-run-port-input"
                        type="number"
                        min={1}
                        max={65535}
                        placeholder={t('docker.runModal.containerPort')}
                        value={row.containerPort}
                        onChange={(e) => updatePort(index, { containerPort: e.target.value })}
                        disabled={busy}
                      />
                      <Select
                        className="docker-run-port-proto"
                        value={row.protocol}
                        disabled={busy}
                        options={[
                          { value: 'tcp', label: 'tcp' },
                          { value: 'udp', label: 'udp' },
                        ]}
                        onChange={(v) => updatePort(index, { protocol: v })}
                      />
                      <button
                        type="button"
                        className="wn-btn wn-btn-tool wn-btn-sm docker-run-row-remove"
                        onClick={() => removePort(index)}
                        disabled={busy || ports.length <= 1}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="wn-btn wn-btn-tool wn-btn-sm"
                    onClick={addPort}
                    disabled={busy}
                  >
                    {t('docker.runModal.addPort')}
                  </button>
                </div>
              </div>

              {envRows.length > 0 && (
                <div className="wn-field">
                  <span className="wn-label">{t('docker.runModal.env')}</span>
                  <div className="docker-run-env">
                    {envRows.map((row, index) => (
                      <div key={row.key} className="docker-run-env-row">
                        <span className="docker-run-env-key" title={row.key}>
                          {row.key}
                          {row.required ? ' *' : ''}
                        </span>
                        <input
                          className="wn-input"
                          type={row.secret ? 'password' : 'text'}
                          placeholder={row.placeholder}
                          value={row.value}
                          onChange={(e) => updateEnv(index, e.target.value)}
                          disabled={busy}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="wn-field">
                <div className="docker-run-extra-env-head">
                  <span className="wn-label">{t('docker.runModal.customEnv')}</span>
                  <button
                    type="button"
                    className="wn-btn wn-btn-tool wn-btn-sm"
                    onClick={addExtraEnv}
                    disabled={busy}
                  >
                    {t('common.add')}
                  </button>
                </div>
                {extraEnv.length > 0 && (
                  <div className="docker-run-env docker-run-extra-env">
                    {extraEnv.map((row, index) => (
                      <div key={index} className="docker-run-env-row docker-run-extra-env-row">
                        <input
                          className="wn-input docker-run-env-key-input"
                          placeholder="KEY"
                          value={row.key}
                          onChange={(e) => updateExtraEnv(index, { key: e.target.value })}
                          disabled={busy}
                        />
                        <input
                          className="wn-input"
                          placeholder="VALUE"
                          value={row.value}
                          onChange={(e) => updateExtraEnv(index, { value: e.target.value })}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="wn-btn wn-btn-tool wn-btn-sm docker-run-row-remove"
                          onClick={() => removeExtraEnv(index)}
                          disabled={busy}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="wn-field docker-run-options">
                <div className="wn-field docker-run-option">
                  <label className="wn-label" htmlFor="docker-run-restart">
                    {t('docker.runModal.restart')}
                  </label>
                  <Select
                    id="docker-run-restart"
                    value={restart}
                    disabled={busy}
                    options={restartOptions.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    onChange={setRestart}
                  />
                </div>
                <label className="docker-run-checkbox">
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => setAutoStart(e.target.checked)}
                    disabled={busy}
                  />
                  {t('docker.runModal.autoStart')}
                </label>
              </div>
            </div>
          )}
          {error && <div className="wn-form-msg error">{error}</div>}
        </div>

        <footer className="wn-modal-footer">
          <button
            type="button"
            className="wn-btn wn-btn-tool"
            {...pressProps(onClose, { disabled: submitting })}
            disabled={submitting}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="wn-btn wn-btn-primary"
            {...pressProps(() => void submit(), { disabled: busy || !tag })}
            disabled={busy || !tag}
          >
            {submitting ? t('docker.runModal.creating') : t('docker.runModal.submit')}
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { ECSMetricSeries, ECSMonitor } from '../../api/types'
import { api } from '../../api/client'
import { IconRefresh } from '../../components/Icons'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'

interface Props {
  hostId: string
  active: boolean
}

const METRIC_LABEL: Record<string, string> = {
  CPUUtilization: 'ecs.cpu',
  memory_usedutilization: 'ecs.mem',
  diskusage_utilization: 'ecs.disk',
  InternetInRate: 'ecs.netIn',
  InternetOutRate: 'ecs.netOut',
}

/** formatMetric 把云监控原始值收成终端条上的短数字。 */
function formatMetric(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—'
  if (unit === '%') return `${Math.round(value)}%`
  if (unit === 'bit/s') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mbps`
    if (value >= 1_000) return `${Math.round(value / 1_000)} Kbps`
    return `${Math.round(value)} bps`
  }
  return `${Math.round(value)}`
}

/** Sparkline 用最近一小时的点画一条细线。 */
function Sparkline({ points }: { points: { value: number }[] }) {
  if (points.length < 2) return null
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const w = 72
  const h = 16
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 2) - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="ecs-monitor-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} />
    </svg>
  )
}

/** ECSMonitorBar 终端上方的阿里云 ECS 监控条。SSH 断开时仍然可读。 */
export function ECSMonitorBar({ hostId, active }: Props) {
  const { t } = useI18n()
  const [mon, setMon] = useState<ECSMonitor | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!active || !hostId) return
    let cancelled = false
    const load = () => {
      setLoading(true)
      api
        .getECSMonitor(hostId)
        .then((next) => {
          if (cancelled) return
          setMon(next)
          setError('')
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message || t('ecs.loadFailed'))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hostId, active, t])

  const series = mon?.series ?? []

  return (
    <div className="ecs-monitor-bar" title={mon?.hint || undefined}>
      {error && !series.length ? (
        <span className="ecs-monitor-error">{error}</span>
      ) : (
        series.map((item) => (
          <MetricCell key={item.metric} item={item} label={t(METRIC_LABEL[item.metric] || item.metric)} />
        ))
      )}
      {mon?.hint && <span className="ecs-monitor-hint">{mon.hint}</span>}
      <button
        type="button"
        className="wn-btn wn-btn-tool ecs-monitor-refresh"
        {...pressProps(() => {
          setLoading(true)
          api
            .getECSMonitor(hostId)
            .then((next) => {
              setMon(next)
              setError('')
            })
            .catch((e: Error) => setError(e.message || t('ecs.loadFailed')))
            .finally(() => setLoading(false))
        })}
        disabled={loading}
      >
        <IconRefresh size={12} />
      </button>
    </div>
  )
}

function MetricCell({ item, label }: { item: ECSMetricSeries; label: string }) {
  const points = item.points ?? []
  const text = item.error ? '—' : points.length ? formatMetric(item.latest, item.unit) : '—'
  return (
    <span className="ecs-monitor-cell" title={item.error || undefined}>
      <span className="ecs-monitor-label">{label}</span>
      <span className="ecs-monitor-value">{text}</span>
      <Sparkline points={points} />
    </span>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { ECSMetricSeries, ECSMonitor, OSSMonitor } from '../../api/types'
import { api } from '../../api/client'
import { IconRefresh } from '../../components/Icons'
import { PaneCollapseButton } from '../../components/layout'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { terminalBackground } from './TerminalPane'

const ECS_MONITOR_COLLAPSED_KEY = 'ecs_monitor_bar__collapsed'

interface Props {
  hostId: string
  active: boolean
  /** 与终端区同一套不透明度。 */
  opacity: number
}

const WINDOW_OPTIONS = [
  { hours: 1, labelKey: 'ecs.range1h' },
  { hours: 6, labelKey: 'ecs.range6h' },
  { hours: 24, labelKey: 'ecs.range24h' },
  { hours: 168, labelKey: 'ecs.range7d' },
] as const

const METRIC_LABEL: Record<string, string> = {
  CPUUtilization: 'ecs.cpu',
  memory_usedutilization: 'ecs.mem',
  diskusage_utilization: 'ecs.disk',
  InternetInRate: 'ecs.netIn',
  InternetOutRate: 'ecs.netOut',
  VPC_PublicIP_InternetInRate: 'ecs.netIn',
  VPC_PublicIP_InternetOutRate: 'ecs.netOut',
  IntranetInRate: 'ecs.netInLan',
  IntranetOutRate: 'ecs.netOutLan',
  OSS_In: 'ecs.ossIn',
  OSS_Out: 'ecs.ossOut',
  OSS_InternetRecv: 'ecs.ossIn',
  OSS_InternetSend: 'ecs.ossOut',
}

/** formatMetric 把云监控原始值收成终端条上的短数字（M/K/b）。 */
function formatMetric(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—'
  if (unit === '%') return `${Math.round(value)}%`
  if (unit === 'bit/s') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${Math.round(value / 1_000)}K`
    return `${Math.round(value)}b`
  }
  return `${Math.round(value)}`
}

/** peakPoint 时间段里的最高点。 */
function peakPoint(points: { timestamp: number; value: number }[]) {
  let best = points[0]
  for (const p of points) {
    if (p.value > best.value) best = p
  }
  return best
}

function formatPeakTime(timestamp: number, windowHours: number): string {
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (windowHours > 24) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
  }
  return hm
}

/** Sparkline 画时间段曲线，并标出峰值。 */
function Sparkline({ points }: { points: { value: number }[] }) {
  if (points.length < 2) return null
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const w = 72
  const h = 16
  let peakI = 0
  const coords = values.map((v, i) => {
    if (v > values[peakI]) peakI = i
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / span) * (h - 2) - 1
    return { x, y }
  })
  const d = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const peak = coords[peakI]
  return (
    <svg className="ecs-monitor-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} />
      <circle className="ecs-monitor-peak-dot" cx={peak.x} cy={peak.y} r="1.6" />
    </svg>
  )
}

/** ECSMonitorBar 终端上方云监控条：ECS + 同地域 OSS 带宽，过宽自动换行；可收起。 */
export function ECSMonitorBar({ hostId, active, opacity }: Props) {
  const { t } = useI18n()
  const [windowHours, setWindowHours] = useState(1)
  const [mon, setMon] = useState<ECSMonitor | null>(null)
  const [oss, setOss] = useState<OSSMonitor | null>(null)
  const [ossError, setOssError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(ECS_MONITOR_COLLAPSED_KEY) === '1',
  )

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(ECS_MONITOR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!active || !hostId || collapsed) return
    let cancelled = false
    const load = () => {
      setLoading(true)
      Promise.all([
        api.getECSMonitor(hostId, windowHours),
        api.getOSSMonitor(hostId, windowHours).then(
          (v) => {
            if (!cancelled) setOssError('')
            return v
          },
          (e: Error) => {
            if (!cancelled) setOssError(e.message || t('ecs.loadFailed'))
            return null
          },
        ),
      ])
        .then(([ecsNext, ossNext]) => {
          if (cancelled) return
          setMon(ecsNext)
          setOss(ossNext)
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
  }, [hostId, active, windowHours, collapsed, t])

  const series = [...(mon?.series ?? []), ...(oss?.series ?? [])]
  const peakWindow = mon?.windowHours || oss?.windowHours || windowHours
  const hint = [mon?.hint, oss?.hint, ossError ? `OSS: ${ossError}` : ''].filter(Boolean).join(' · ')

  const refresh = () => {
    setLoading(true)
    Promise.all([
      api.getECSMonitor(hostId, windowHours),
      api.getOSSMonitor(hostId, windowHours).then(
        (v) => {
          setOssError('')
          return v
        },
        (e: Error) => {
          setOssError(e.message || t('ecs.loadFailed'))
          return null
        },
      ),
    ])
      .then(([ecsNext, ossNext]) => {
        setMon(ecsNext)
        setOss(ossNext)
        setError('')
      })
      .catch((e: Error) => setError(e.message || t('ecs.loadFailed')))
      .finally(() => setLoading(false))
  }

  if (collapsed) {
    return (
      <div
        className="ecs-monitor-bar is-collapsed"
        style={{ backgroundColor: terminalBackground(opacity) }}
      >
        <button
          type="button"
          className="ecs-monitor-expand"
          title={t('ecs.expandBar')}
          aria-expanded={false}
          {...pressProps(toggleCollapsed)}
        >
          <span className="tree-chevron wn-collapse-chevron is-y is-collapsed" aria-hidden />
          <span className="ecs-monitor-expand-label">{t('ecs.barTitle')}</span>
        </button>
      </div>
    )
  }

  return (
    <div
      className="ecs-monitor-bar"
      style={{ backgroundColor: terminalBackground(opacity) }}
      title={hint || undefined}
    >
      <PaneCollapseButton
        axis="y"
        onToggle={toggleCollapsed}
        title={t('ecs.collapseBar')}
        className="ecs-monitor-collapse"
      />
      <select
        className="ecs-monitor-range"
        value={windowHours}
        aria-label={t('ecs.range')}
        title={t('ecs.range')}
        onChange={(e) => setWindowHours(Number(e.target.value) || 1)}
      >
        {WINDOW_OPTIONS.map((opt) => (
          <option key={opt.hours} value={opt.hours}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
      {error && !series.length ? (
        <span className="ecs-monitor-error">{error}</span>
      ) : (
        series.map((item) => (
          <MetricCell
            key={item.metric}
            item={item}
            label={t(METRIC_LABEL[item.metric] || item.metric)}
            windowHours={peakWindow}
          />
        ))
      )}
      {hint ? <span className="ecs-monitor-hint">{hint}</span> : null}
      <button
        type="button"
        className="wn-btn wn-btn-tool ecs-monitor-refresh"
        {...pressProps(refresh)}
        disabled={loading}
      >
        <IconRefresh size={12} />
      </button>
    </div>
  )
}

function MetricCell({
  item,
  label,
  windowHours,
}: {
  item: ECSMetricSeries
  label: string
  windowHours: number
}) {
  const points = item.points ?? []
  const text = item.error ? '—' : points.length ? formatMetric(item.latest, item.unit) : '—'
  const peak = points.length ? peakPoint(points) : null
  const peakText = peak ? formatMetric(peak.value, item.unit) : ''
  const peakAt = peak ? formatPeakTime(peak.timestamp, windowHours) : ''
  return (
    <span className="ecs-monitor-cell" title={item.error || undefined}>
      <span className="ecs-monitor-label">{label}</span>
      <span className="ecs-monitor-value">{text}</span>
      {peak ? (
        <span className="ecs-monitor-peak" title={peakAt || undefined}>
          {peakText}
        </span>
      ) : null}
      <Sparkline points={points} />
    </span>
  )
}

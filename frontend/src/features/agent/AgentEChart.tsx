import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts'
import { chartLayoutKind, normalizeEChartOption } from '../../utils/echartOption'

interface Props {
  option: Record<string, unknown>
  error?: string
}

/** AgentEChart 渲染 ECharts 图表。 */
export function AgentEChart({ option, error }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const normalized = useMemo(() => normalizeEChartOption(option), [option])
  const layout = useMemo(() => chartLayoutKind(option), [option])

  useEffect(() => {
    if (error || !ref.current) return
    const el = ref.current
    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    try {
      chart.setOption(normalized as echarts.EChartsOption, { notMerge: true })
    } catch (e) {
      console.error(e)
    }
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [normalized, error])

  if (error) {
    return <div className="agent-chart agent-chart-error">{error}</div>
  }

  const chartClass =
    layout === 'pie'
      ? 'agent-chart agent-chart-pie'
      : layout === 'tall'
        ? 'agent-chart agent-chart-tall'
        : 'agent-chart'

  return (
    <div className={chartClass} ref={ref} />
  )
}

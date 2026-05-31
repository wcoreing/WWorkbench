import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

interface Props {
  option: Record<string, unknown>
  error?: string
}

/** AgentEChart 渲染 ECharts 图表。 */
export function AgentEChart({ option, error }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error || !ref.current) return
    const el = ref.current
    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    try {
      chart.setOption(option as echarts.EChartsOption, { notMerge: true })
    } catch (e) {
      console.error(e)
    }
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [option, error])

  if (error) {
    return <div className="agent-chart agent-chart-error">{error}</div>
  }

  return <div className="agent-chart" ref={ref} />
}

type Rec = Record<string, unknown>

function asRecord(v: unknown): Rec | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null
}

function seriesList(series: unknown): Rec[] {
  if (!series) return []
  if (Array.isArray(series)) return series.filter((s) => asRecord(s)) as Rec[]
  const one = asRecord(series)
  return one ? [one] : []
}

function axisList(axis: unknown): Rec[] {
  if (!axis) return []
  if (Array.isArray(axis)) return axis.filter((a) => asRecord(a)) as Rec[]
  const one = asRecord(axis)
  return one ? [one] : []
}

/** isBottomLegend 图例是否在底部（与 x 轴 / 饼图标签易重叠）。 */
function isBottomLegend(legend: unknown): boolean {
  if (!legend) return false
  if (Array.isArray(legend)) return legend.some(isBottomLegend)
  const l = asRecord(legend)
  if (!l || l.show === false) return false
  if (l.top !== undefined && l.top !== '') return false
  if (l.bottom !== undefined) return true
  return false
}

function categoryAxisNeedsRoom(axis: Rec): boolean {
  if (axis.type !== 'category') return false
  const data = axis.data
  if (!Array.isArray(data) || data.length === 0) return false
  const labels = data.map((d) => String(d))
  const maxLen = labels.reduce((m, s) => Math.max(m, s.length), 0)
  return data.length > 4 || maxLen >= 8 || /\d{4}-\d{2}-\d{2}/.test(labels.join(''))
}

function isPieChart(option: Rec): boolean {
  return seriesList(option.series).some((s) => s.type === 'pie')
}

function titleHasSubtext(title: unknown): boolean {
  const t = asRecord(title)
  if (!t) return false
  const sub = t.subtext
  return typeof sub === 'string' && sub.trim() !== ''
}

function normalizeTitle(option: Rec): void {
  const title = asRecord(option.title)
  if (!title) return
  if (title.top === undefined) title.top = 6
  if (title.left === undefined) title.left = 'center'
  if (titleHasSubtext(title) && title.itemGap === undefined) title.itemGap = 2
  const textStyle = asRecord(title.textStyle) ?? {}
  if (textStyle.fontSize === undefined) textStyle.fontSize = 13
  title.textStyle = textStyle
  const subStyle = asRecord(title.subtextStyle) ?? {}
  if (subStyle.fontSize === undefined) subStyle.fontSize = 11
  if (subStyle.color === undefined) subStyle.color = '#8b93a1'
  title.subtextStyle = subStyle
  option.title = title
}

function normalizePieChart(option: Rec): void {
  if (!isPieChart(option)) return

  normalizeTitle(option)

  const hasTitle = option.title !== undefined
  const hasSub = titleHasSubtext(option.title)
  const bottomLegend = isBottomLegend(option.legend)

  if (bottomLegend) {
    const leg = asRecord(option.legend) ?? {}
    leg.bottom = typeof leg.bottom === 'number' ? Math.min(leg.bottom, 6) : 4
    if (leg.left === undefined) leg.left = 'center'
    option.legend = leg
  }

  const outerPct = hasTitle && hasSub ? 34 : hasTitle ? 38 : 42
  const innerPct = Math.round(outerPct * 0.62)
  let centerY = 50
  if (hasTitle && bottomLegend) centerY = hasSub ? 54 : 52
  else if (hasTitle) centerY = hasSub ? 52 : 50
  else if (bottomLegend) centerY = 46

  for (const s of seriesList(option.series)) {
    if (s.type !== 'pie') continue

    const radius = s.radius
    if (radius === undefined) {
      s.radius = [`${innerPct}%`, `${outerPct}%`]
    } else if (Array.isArray(radius) && radius.length >= 2) {
      s.radius = [`${innerPct}%`, `${outerPct}%`]
    } else if (typeof radius === 'string' || typeof radius === 'number') {
      s.radius = `${Math.min(outerPct, 42)}%`
    }

    s.center = [`50%`, `${centerY}%`]

    const label = asRecord(s.label)
    if (label?.show === false) continue

    const lbl = label ?? {}
    const pos = lbl.position
    const outside = pos === undefined || pos === 'outside' || pos === 'outer'
    if (outside) {
      lbl.alignTo = lbl.alignTo ?? 'edge'
      lbl.edgeDistance = lbl.edgeDistance ?? 12
      lbl.bleedMargin = lbl.bleedMargin ?? 10
      lbl.distanceToLabelLine = lbl.distanceToLabelLine ?? 4
      lbl.overflow = lbl.overflow ?? 'break'
      lbl.width = lbl.width ?? 88
      s.label = lbl

      const line = asRecord(s.labelLine) ?? {}
      line.length = typeof line.length === 'number' ? Math.min(line.length, 10) : 8
      line.length2 = typeof line.length2 === 'number' ? Math.min(line.length2, 10) : 8
      line.smooth = line.smooth ?? true
      s.labelLine = line

      const layout = asRecord(s.labelLayout) ?? {}
      layout.hideOverlap = layout.hideOverlap ?? true
      s.labelLayout = layout
    }
  }
}

function labelsTilt(axis: Rec): boolean {
  const data = axis.data
  if (!Array.isArray(data)) return false
  return data.length > 5 || data.some((d) => String(d).length >= 8)
}

function normalizeCartesian(option: Rec): void {
  const bottomLegend = isBottomLegend(option.legend)
  const xAxes = axisList(option.xAxis)
  const xNeedsRoom = xAxes.some(categoryAxisNeedsRoom)

  let rotate = false
  for (const axis of xAxes) {
    if (!categoryAxisNeedsRoom(axis)) continue
    const al = asRecord(axis.axisLabel) ?? {}
    if (al.rotate === undefined) {
      al.rotate = labelsTilt(axis) ? 32 : 0
      rotate = Number(al.rotate) > 0
    } else if (Number(al.rotate) > 0) {
      rotate = true
    }
    if (al.margin === undefined) al.margin = 10
    axis.axisLabel = al
  }

  const grid = asRecord(option.grid) ?? {}
  if (grid.containLabel === undefined) grid.containLabel = true

  let bottom = typeof grid.bottom === 'number' ? grid.bottom : 0
  if (bottomLegend) {
    bottom = Math.max(bottom, rotate ? 96 : 80)
    const leg = asRecord(option.legend)
    if (leg) {
      leg.bottom = typeof leg.bottom === 'number' ? Math.min(leg.bottom, 8) : 6
      option.legend = leg
    }
  } else if (xNeedsRoom) {
    bottom = Math.max(bottom, rotate ? 72 : 56)
  }
  if (bottom > 0) grid.bottom = bottom
  option.grid = grid
}

/** normalizeEChartOption 修正易重叠的布局（饼图 / 底部图例 / 日期 x 轴）。 */
export function normalizeEChartOption(raw: Record<string, unknown>): Record<string, unknown> {
  const option: Rec = JSON.parse(JSON.stringify(raw)) as Rec

  if (isPieChart(option)) {
    normalizePieChart(option)
    return option
  }

  normalizeCartesian(option)
  return option
}

export type ChartLayoutKind = 'pie' | 'tall' | 'default'

/** chartLayoutKind 画布尺寸档位。 */
export function chartLayoutKind(raw: Record<string, unknown>): ChartLayoutKind {
  const option = raw as Rec
  if (isPieChart(option)) return 'pie'
  if (isBottomLegend(raw.legend) || axisList(raw.xAxis).some(categoryAxisNeedsRoom)) {
    return 'tall'
  }
  return 'default'
}

/** chartNeedsTallLayout 是否需要更高画布（兼容旧调用）。 */
export function chartNeedsTallLayout(raw: Record<string, unknown>): boolean {
  return chartLayoutKind(raw) !== 'default'
}

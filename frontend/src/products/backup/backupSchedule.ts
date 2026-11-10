/** 备份定时：重复星期 + 开始时刻 → 五段 cron（分固定 0）。 */

export type BackupSchedule = {
  /** cron 星期：0=周日 … 6=周六 */
  weekdays: number[]
  /** 小时 0–23 */
  hours: number[]
}

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

export const WEEKDAY_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 1, labelKey: 'backup.weekdayMon' },
  { value: 2, labelKey: 'backup.weekdayTue' },
  { value: 3, labelKey: 'backup.weekdayWed' },
  { value: 4, labelKey: 'backup.weekdayThu' },
  { value: 5, labelKey: 'backup.weekdayFri' },
  { value: 6, labelKey: 'backup.weekdaySat' },
  { value: 0, labelKey: 'backup.weekdaySun' },
]

/** 常用开始时刻（整点），芯片点选。 */
export const HOUR_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22]

function uniqSorted(nums: number[]): number[] {
  return [...new Set(nums.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
}

function parseCronList(field: string, min: number, max: number): number[] | null {
  const f = field.trim()
  if (f === '*') {
    const out: number[] = []
    for (let i = min; i <= max; i++) out.push(i)
    return out
  }
  const out: number[] = []
  for (const part of f.split(',')) {
    const p = part.trim()
    if (!p || p.includes('/')) return null
    if (/^\d+-\d+$/.test(p)) {
      const [a, b] = p.split('-').map(Number)
      if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null
      for (let i = a; i <= b; i++) {
        if (i < min || i > max) return null
        out.push(i)
      }
      continue
    }
    const n = Number(p)
    if (!Number.isFinite(n) || n < min || n > max) return null
    out.push(n)
  }
  return uniqSorted(out)
}

/** 解析可可视化编辑的 cron；不支持步进/复杂字段时返回 null。 */
export function parseBackupCron(expr: string): BackupSchedule | null {
  const raw = expr.trim()
  if (!raw) return null
  const fields = raw.split(/\s+/)
  if (fields.length !== 5) return null
  const [min, hour, dom, mon, dow] = fields
  if (min !== '0' || dom !== '*' || mon !== '*') return null
  if (hour.includes('/')) return null
  const hours = parseCronList(hour, 0, 23)
  if (!hours || hours.length === 0) return null
  let weekdays: number[]
  if (dow === '*') {
    weekdays = [...ALL_WEEKDAYS]
  } else {
    const parsed = parseCronList(dow.replace(/7/g, '0'), 0, 6)
    if (!parsed || parsed.length === 0) return null
    weekdays = parsed
  }
  return { weekdays, hours }
}

/** 由重复日期与开始时刻生成 cron；全选星期用 *。 */
export function buildBackupCron(schedule: BackupSchedule): string {
  const hours = uniqSorted(schedule.hours.filter((h) => h >= 0 && h <= 23))
  const weekdays = uniqSorted(schedule.weekdays.filter((d) => d >= 0 && d <= 6))
  if (hours.length === 0 || weekdays.length === 0) return ''
  const hourField = hours.join(',')
  const allDays =
    weekdays.length === 7 && ALL_WEEKDAYS.every((d) => weekdays.includes(d))
  const dowField = allDays ? '*' : weekdays.join(',')
  return `0 ${hourField} * * ${dowField}`
}

export function defaultSchedule(): BackupSchedule {
  return { weekdays: [...ALL_WEEKDAYS], hours: [3] }
}

export function formatHourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export function toggleNumber(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((x) => x !== value) : uniqSorted([...list, value])
}

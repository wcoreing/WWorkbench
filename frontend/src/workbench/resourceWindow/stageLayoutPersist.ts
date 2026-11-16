import { api } from '../../api/client'
import type { ResourceKind } from './types'

const PREFIX = 'project_stage_layout:'

/** StageLayoutItem 可持久化的舞台面板摘要（不含运行时 window id）。 */
export type StageLayoutItem = {
  kind: ResourceKind
  resourceId: string
  title: string
}

function settingKey(stageKey: string): string {
  return `${PREFIX}${stageKey}`
}

/** loadStageLayout 读取项目舞台上次面板布局。 */
export async function loadStageLayout(stageKey: string): Promise<StageLayoutItem[]> {
  const key = (stageKey || '').trim()
  if (!key) return []
  try {
    const settings = await api.listAppSettings()
    const raw = String(settings[settingKey(key)] || '').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw) as { panels?: StageLayoutItem[] }
    const panels = Array.isArray(parsed?.panels) ? parsed.panels : []
    return panels
      .filter((p) => p && typeof p.kind === 'string' && typeof p.resourceId === 'string' && p.resourceId)
      .map((p) => ({
        kind: p.kind as ResourceKind,
        resourceId: String(p.resourceId),
        title: String(p.title || p.resourceId),
      }))
  } catch {
    return []
  }
}

/** saveStageLayout 写入项目舞台面板布局（空则清掉）。 */
export async function saveStageLayout(stageKey: string, panels: StageLayoutItem[]): Promise<void> {
  const key = (stageKey || '').trim()
  if (!key) return
  const value = panels.length ? JSON.stringify({ panels }) : ''
  await api.setAppSetting(settingKey(key), value)
}

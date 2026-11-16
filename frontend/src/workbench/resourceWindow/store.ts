import { create } from 'zustand'
import type { ResourceWindow } from './types'

const MAX_PANELS_PER_STAGE = 4

type State = {
  panelsByStage: Record<string, ResourceWindow[]>
  activePanelIdByStage: Record<string, string>
  /** 舞台最大化面板 id；空=并排。 */
  maximizedPanelIdByStage: Record<string, string>
  dialog: ResourceWindow | null
  upsertPanel: (win: ResourceWindow) => void
  focusPanel: (stageKey: string, id: string) => void
  closePanel: (stageKey: string, id: string) => void
  /** 拖拽调序：把 fromId 面板移到 toId 位置。 */
  reorderPanel: (stageKey: string, fromId: string, toId: string) => void
  setMaximizedPanel: (stageKey: string, id: string) => void
  clearStage: (stageKey: string) => void
  setDialog: (win: ResourceWindow | null) => void
}

function stageList(state: State, stageKey: string): ResourceWindow[] {
  return state.panelsByStage[stageKey] || []
}

/** useResourceWindowStore 舞台面板与弹窗壳状态。 */
export const useResourceWindowStore = create<State>((set) => ({
  panelsByStage: {},
  activePanelIdByStage: {},
  maximizedPanelIdByStage: {},
  dialog: null,

  upsertPanel: (win) => {
    const stageKey = win.stageKey || 'global'
    set((s) => {
      const prev = stageList(s, stageKey)
      const same = prev.findIndex((w) => w.kind === win.kind && w.resourceId === win.resourceId)
      let next: ResourceWindow[]
      if (same >= 0) {
        next = prev.slice()
        next[same] = { ...prev[same], ...win, id: prev[same].id }
      } else {
        next = [...prev, win]
        while (next.length > MAX_PANELS_PER_STAGE) {
          next = next.slice(1)
        }
      }
      const activeId = same >= 0 ? next[same].id : win.id
      return {
        panelsByStage: { ...s.panelsByStage, [stageKey]: next },
        activePanelIdByStage: { ...s.activePanelIdByStage, [stageKey]: activeId },
      }
    })
  },

  focusPanel: (stageKey, id) => {
    set((s) => ({
      activePanelIdByStage: { ...s.activePanelIdByStage, [stageKey]: id },
    }))
  },

  closePanel: (stageKey, id) => {
    set((s) => {
      const prev = stageList(s, stageKey).filter((w) => w.id !== id)
      const active = s.activePanelIdByStage[stageKey]
      const nextActive =
        active === id ? (prev[prev.length - 1]?.id || '') : active || ''
      const panelsByStage = { ...s.panelsByStage }
      if (prev.length) panelsByStage[stageKey] = prev
      else delete panelsByStage[stageKey]
      const activePanelIdByStage = { ...s.activePanelIdByStage }
      if (nextActive) activePanelIdByStage[stageKey] = nextActive
      else delete activePanelIdByStage[stageKey]
      const maximizedPanelIdByStage = { ...s.maximizedPanelIdByStage }
      if (maximizedPanelIdByStage[stageKey] === id) {
        if (nextActive) maximizedPanelIdByStage[stageKey] = nextActive
        else delete maximizedPanelIdByStage[stageKey]
      }
      return { panelsByStage, activePanelIdByStage, maximizedPanelIdByStage }
    })
  },

  reorderPanel: (stageKey, fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    set((s) => {
      const prev = stageList(s, stageKey)
      const from = prev.findIndex((w) => w.id === fromId)
      const to = prev.findIndex((w) => w.id === toId)
      if (from < 0 || to < 0 || from === to) return s
      const next = prev.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item!)
      return { panelsByStage: { ...s.panelsByStage, [stageKey]: next } }
    })
  },

  setMaximizedPanel: (stageKey, id) => {
    set((s) => {
      const maximizedPanelIdByStage = { ...s.maximizedPanelIdByStage }
      const cur = maximizedPanelIdByStage[stageKey] || ''
      if (!id || cur === id) delete maximizedPanelIdByStage[stageKey]
      else maximizedPanelIdByStage[stageKey] = id
      return { maximizedPanelIdByStage }
    })
  },

  clearStage: (stageKey) => {
    set((s) => {
      const panelsByStage = { ...s.panelsByStage }
      delete panelsByStage[stageKey]
      const activePanelIdByStage = { ...s.activePanelIdByStage }
      delete activePanelIdByStage[stageKey]
      const maximizedPanelIdByStage = { ...s.maximizedPanelIdByStage }
      delete maximizedPanelIdByStage[stageKey]
      return { panelsByStage, activePanelIdByStage, maximizedPanelIdByStage }
    })
  },

  setDialog: (win) => set({ dialog: win }),
}))

export function listStagePanels(stageKey: string): ResourceWindow[] {
  return useResourceWindowStore.getState().panelsByStage[stageKey] || []
}

export function getStageActivePanelId(stageKey: string): string {
  return useResourceWindowStore.getState().activePanelIdByStage[stageKey] || ''
}

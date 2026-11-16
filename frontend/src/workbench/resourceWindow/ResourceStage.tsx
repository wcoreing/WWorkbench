import { useState, type DragEvent } from 'react'
import { useI18n } from '../../i18n'
import { pressProps } from '../../components/compat'
import { ResourceSurfaceRouter } from './surfaces/ResourceSurfaceRouter'
import { ResourceWindowChrome } from './ResourceWindowChrome'
import { useResourceWindowStore } from './store'
import type { ResourceWindow } from './types'
import './resourceWindow.css'

/** 稳定空数组：避免 selector 里 `|| []` 每次新引用触发无限重渲染。 */
const EMPTY_PANELS: ResourceWindow[] = []

type Props = {
  stageKey: string
  /** 空舞台时不渲染（项目页默认弹窗，避免空舞台占位）。 */
  hideEmpty?: boolean
  /** 空舞台提示旁的操作（如打开项目笔记）。 */
  emptyActions?: { label: string; onPress: () => void; primary?: boolean }[]
}

/** ResourceStage 项目等宿主的面板舞台：横向并排、拖拽调序、单面板最大化。 */
export function ResourceStage({ stageKey, hideEmpty = false, emptyActions }: Props) {
  const { t } = useI18n()
  const panels = useResourceWindowStore((s) => s.panelsByStage[stageKey] ?? EMPTY_PANELS)
  const activeId = useResourceWindowStore((s) => s.activePanelIdByStage[stageKey] ?? '')
  const maximizedId = useResourceWindowStore((s) => s.maximizedPanelIdByStage[stageKey] ?? '')
  const focusPanel = useResourceWindowStore((s) => s.focusPanel)
  const closePanel = useResourceWindowStore((s) => s.closePanel)
  const reorderPanel = useResourceWindowStore((s) => s.reorderPanel)
  const setMaximizedPanel = useResourceWindowStore((s) => s.setMaximizedPanel)
  const [dragId, setDragId] = useState('')
  const [overId, setOverId] = useState('')

  if (!panels.length) {
    if (hideEmpty) return null
    return (
      <div className="rw-stage rw-stage-empty">
        <p className="rw-stage-empty-title">{t('resourceWindow.stageEmpty')}</p>
        <p className="rw-stage-empty-hint">{t('resourceWindow.stageEmptyHint')}</p>
        {emptyActions?.length ? (
          <div className="rw-stage-empty-actions">
            {emptyActions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`wn-btn wn-btn-sm${a.primary ? ' wn-btn-primary' : ' wn-btn-tool'}`}
                {...pressProps(a.onPress)}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const maximized = maximizedId ? panels.find((p) => p.id === maximizedId) : null
  const visible = maximized ? [maximized] : panels

  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData('text/rw-panel-id', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }

  const onDragOver = (e: DragEvent, id: string) => {
    if (!dragId || maximized) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== overId) setOverId(id)
  }

  const onDrop = (e: DragEvent, toId: string) => {
    e.preventDefault()
    if (maximized) return
    const fromId = e.dataTransfer.getData('text/rw-panel-id') || dragId
    if (fromId && toId) reorderPanel(stageKey, fromId, toId)
    setDragId('')
    setOverId('')
  }

  const onDragEnd = () => {
    setDragId('')
    setOverId('')
  }

  return (
    <div
      className={`rw-stage${maximized ? ' is-maximized' : ''}`}
      data-count={maximized ? 1 : panels.length}
    >
      {visible.map((win: ResourceWindow) => {
        const active = win.id === activeId || visible.length === 1
        const isMax = maximized?.id === win.id
        return (
          <section
            key={win.id}
            className={`rw-panel${active ? ' is-active' : ''}${dragId === win.id ? ' is-dragging' : ''}${
              overId === win.id && dragId && dragId !== win.id ? ' is-drop-target' : ''
            }${isMax ? ' is-maximized' : ''}`}
            onDragOver={(e) => onDragOver(e, win.id)}
            onDrop={(e) => onDrop(e, win.id)}
            onPointerDown={() => focusPanel(stageKey, win.id)}
          >
            <ResourceWindowChrome
              window={win}
              active={active}
              chrome="panel"
              onFocus={() => focusPanel(stageKey, win.id)}
              onClose={() => closePanel(stageKey, win.id)}
              onDragStart={isMax ? undefined : (e) => onDragStart(e, win.id)}
              onDragEnd={onDragEnd}
              dragTitle={t('resourceWindow.dragReorder')}
              maximized={isMax}
              onToggleMaximize={() => setMaximizedPanel(stageKey, win.id)}
            />
            <div className="rw-panel-body">
              <ResourceSurfaceRouter window={win} active={active} />
            </div>
          </section>
        )
      })}
    </div>
  )
}

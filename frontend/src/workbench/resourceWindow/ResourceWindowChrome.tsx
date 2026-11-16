import type { DragEventHandler } from 'react'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { openAsProduct } from './openResource'
import type { ResourceWindow } from './types'

type Props = {
  window: ResourceWindow
  active: boolean
  onFocus: () => void
  onClose: () => void
  /** panel | dialog 影响按钮文案密度。 */
  chrome?: 'panel' | 'dialog'
  /** 舞台拖拽把手（仅 panel）。 */
  onDragStart?: DragEventHandler
  onDragEnd?: DragEventHandler
  dragTitle?: string
  maximized?: boolean
  onToggleMaximize?: () => void
}

/** ResourceWindowChrome 面板/弹窗共用标题条。 */
export function ResourceWindowChrome({
  window: win,
  active,
  onFocus,
  onClose,
  chrome = 'panel',
  onDragStart,
  onDragEnd,
  dragTitle,
  maximized,
  onToggleMaximize,
}: Props) {
  const { t } = useI18n()
  return (
    <header
      className={`rw-chrome${active ? ' is-active' : ''}${chrome === 'dialog' ? ' is-dialog' : ''}${
        maximized ? ' is-maximized' : ''
      }`}
      onPointerDown={onFocus}
    >
      {chrome === 'panel' && onDragStart && !maximized ? (
        <span
          className="rw-chrome-grip"
          draggable
          title={dragTitle || t('resourceWindow.dragReorder')}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onPointerDown={(e) => e.stopPropagation()}
        >
          ⋮⋮
        </span>
      ) : null}
      <div className="rw-chrome-title" title={win.title}>
        <span className="rw-chrome-kind">{win.kind}</span>
        <span className="rw-chrome-label">{win.title}</span>
      </div>
      <div className="rw-chrome-actions">
        {chrome === 'panel' && onToggleMaximize ? (
          <button
            type="button"
            className="wn-btn wn-btn-icon wn-btn-sm"
            title={maximized ? t('resourceWindow.restorePanel') : t('resourceWindow.maximizePanel')}
            {...pressProps(onToggleMaximize)}
          >
            {maximized ? '⧉' : '⬜'}
          </button>
        ) : null}
        <button
          type="button"
          className="wn-btn wn-btn-icon wn-btn-sm"
          title={t('resourceWindow.openInProduct')}
          {...pressProps(() => {
            openAsProduct({
              kind: win.kind,
              resourceId: win.resourceId,
              title: win.title,
              presentation: 'product',
            })
          })}
        >
          ↗
        </button>
        <button
          type="button"
          className="wn-btn wn-btn-icon wn-btn-sm"
          title={t('common.close')}
          {...pressProps(onClose)}
        >
          ×
        </button>
      </div>
    </header>
  )
}

import { CollapseRail } from './CollapseRail'
import { ResizeHandle } from './ResizeHandle'
import type { ResizeAxis } from './useResizable'

type Props = {
  axis: ResizeAxis
  resizeTitle?: string
  onResizeMouseDown?: (e: React.MouseEvent) => void
  collapsible?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** 双击收起提示（拼进分隔条 title） */
  collapseTitle?: string
  expandTitle?: string
  /** 收起轨短标题 */
  railLabel?: string
}

function composeSashTitle(resizeTitle?: string, collapseTitle?: string) {
  if (resizeTitle && collapseTitle) return `${resizeTitle} · ${collapseTitle}`
  return collapseTitle ?? resizeTitle
}

/** 分栏沟槽：拖拽为手势；双击收起；收起后为带标题展开轨 */
export function PaneGutter({
  axis,
  resizeTitle,
  onResizeMouseDown,
  collapsible,
  collapsed,
  onToggleCollapse,
  collapseTitle,
  expandTitle,
  railLabel,
}: Props) {
  if (collapsed && collapsible && onToggleCollapse) {
    return (
      <CollapseRail
        axis={axis}
        label={railLabel}
        title={expandTitle}
        onToggle={onToggleCollapse}
      />
    )
  }

  if (!onResizeMouseDown) return null

  return (
    <div className={`wn-pane-gutter wn-pane-gutter-${axis}`}>
      <ResizeHandle
        axis={axis}
        onMouseDown={onResizeMouseDown}
        onDoubleClick={
          collapsible && onToggleCollapse
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                onToggleCollapse()
              }
            : undefined
        }
        title={composeSashTitle(
          resizeTitle,
          collapsible ? collapseTitle : undefined,
        )}
      />
    </div>
  )
}

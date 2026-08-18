import type { PaneLayout } from './terminalLayout'
import { countLeaves, setSplitRatio } from './terminalLayout'
import { TerminalPane, terminalBackground } from './TerminalPane'

interface Props {
  layout: PaneLayout
  rootLayout: PaneLayout
  activePaneId: string
  /** 所属标签页当前可见（非 display:none）。 */
  tabActive: boolean
  opacity: number
  onSelectPane: (paneId: string) => void
  onLayoutChange: (layout: PaneLayout) => void
  onClosePane?: (paneId: string) => void
}

/** 递归渲染终端分屏布局 */
export function TerminalSplitView({
  layout,
  rootLayout,
  activePaneId,
  tabActive,
  opacity,
  onSelectPane,
  onLayoutChange,
  onClosePane,
}: Props) {
  const paneCount = countLeaves(rootLayout)
  const closable = paneCount > 1 && Boolean(onClosePane)

  if (layout.kind === 'leaf') {
    return (
      <div
        className={`terminal-split-leaf ${layout.paneId === activePaneId ? 'focused' : ''}`}
        style={{ backgroundColor: terminalBackground(opacity) }}
        onMouseDown={() => onSelectPane(layout.paneId)}
      >
        {closable && (
          <div className="terminal-split-leaf-bar">
            <button
              type="button"
              className="terminal-split-leaf-close"
              title="关闭此窗格"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onClosePane?.(layout.paneId)
              }}
            >
              ×
            </button>
          </div>
        )}
        <TerminalPane
          sessionId={layout.sessionId}
          active={tabActive}
          focused={tabActive && layout.paneId === activePaneId}
          opacity={opacity}
        />
      </div>
    )
  }

  return (
    <SplitNode
      node={layout}
      rootLayout={rootLayout}
      activePaneId={activePaneId}
      tabActive={tabActive}
      opacity={opacity}
      onSelectPane={onSelectPane}
      onLayoutChange={onLayoutChange}
      onClosePane={onClosePane}
    />
  )
}

interface SplitNodeProps {
  node: Extract<PaneLayout, { kind: 'split' }>
  rootLayout: PaneLayout
  activePaneId: string
  tabActive: boolean
  opacity: number
  onSelectPane: (paneId: string) => void
  onLayoutChange: (layout: PaneLayout) => void
  onClosePane?: (paneId: string) => void
}

function SplitNode({
  node,
  rootLayout,
  activePaneId,
  tabActive,
  opacity,
  onSelectPane,
  onLayoutChange,
  onClosePane,
}: SplitNodeProps) {
  const isRow = node.direction === 'row'

  /** 拖拽调整分屏比例 */
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const host = (e.currentTarget as HTMLElement).parentElement
    if (!host) return
    const rect = host.getBoundingClientRect()
    const total = isRow ? rect.width : rect.height

    const onMove = (ev: MouseEvent) => {
      const pos = (isRow ? ev.clientX : ev.clientY) - (isRow ? rect.left : rect.top)
      const next = Math.min(0.85, Math.max(0.15, pos / total))
      onLayoutChange(setSplitRatio(rootLayout, node.paneId, next))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className={`terminal-split-node ${isRow ? 'row' : 'col'}`}>
      <div className="terminal-split-pane" style={{ flex: node.ratio }}>
        <TerminalSplitView
          layout={node.first}
          rootLayout={rootLayout}
          activePaneId={activePaneId}
          tabActive={tabActive}
          opacity={opacity}
          onSelectPane={onSelectPane}
          onLayoutChange={onLayoutChange}
          onClosePane={onClosePane}
        />
      </div>
      <div
        className={`terminal-split-divider ${isRow ? 'h' : 'v'}`}
        onMouseDown={onDragStart}
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
      />
      <div className="terminal-split-pane" style={{ flex: 1 - node.ratio }}>
        <TerminalSplitView
          layout={node.second}
          rootLayout={rootLayout}
          activePaneId={activePaneId}
          tabActive={tabActive}
          opacity={opacity}
          onSelectPane={onSelectPane}
          onLayoutChange={onLayoutChange}
          onClosePane={onClosePane}
        />
      </div>
    </div>
  )
}

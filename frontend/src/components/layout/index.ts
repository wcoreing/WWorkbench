/**
 * 布局语言（拼装约定）
 *
 * 区域：Rail | Sidebar | Main | Aux
 * 分隔：ResizeHandle / PaneGutter 为尺寸手势面（拖=调尺寸，双击=收起）；
 *       标题栏用 PaneCollapseButton 作为可发现主入口；收起后 CollapseRail 展开；
 *       折叠状态经 usePaneCollapse 与分栏受控同步；收起固定栏须同步缩小外层侧栏宽度，把空间还给 Main；
 *       禁止产品内私有拖拽/折叠布局
 * 分隔线：一律由 Handle/Gutter/收起轨绘制——常态 1px --color-border，悬停/拖动变 --accent；
 *         pane / sidebar-section 不得再用 border 充当分栏线（stack/columns 内已强制 border:none）
 * 拼装：ProductLayout（侧栏|主区）→ SidebarStack（纵向）/ SidebarColumns（横向）→ Main 内再 Split
 *
 * 间距：只用 tokens.css 的 --space-1..4 / --chrome-pad-x / --content-pad / --chrome-gap
 *       Chrome 紧（pad-x / gap），内容区用 --content-pad
 * 图标：--icon-sm（工具条/树）--icon-md（列表）--icon-rail（产品轨）
 * 高度：--toolbar-height / --control-height / --control-height-chrome
 *
 * 工具类：theme/spacing.css（wn-pad-* / wn-gap-* / wn-row / wn-stack）
 */

export { CollapseRail } from './CollapseRail'
export { PaneCollapseButton } from './PaneCollapseButton'
export { PaneGutter } from './PaneGutter'
export { ProductLayout } from './ProductLayout'
export { ResizeHandle } from './ResizeHandle'
export { SidebarColumns, type ColumnSection } from './SidebarColumns'
export { SidebarStack, type StackSection } from './SidebarStack'
export { usePaneCollapse } from './usePaneCollapse'
export { useResizable } from './useResizable'

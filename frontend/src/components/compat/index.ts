/**
 * WWorkbench Compat — 平台交互兼容层（不是视觉 UI 框架）。
 *
 * 定位：Compat 修 Wails/WebView 兼容性；长相可套 wn-* / Ant / shadcn 等。
 *
 * 契约：
 * 1. 命令控件（Tab / 工具条 / 弹窗脚 / 菜单项）→ pressProps，禁止裸 onClick
 * 2. 业务下拉 → Select（或自绘 + useOutsideDismiss），禁止原生 select
 * 3. 弹层挂载 → ModalPortal
 * 4. 菜单外点关闭 → pointerdown（useDismissOnPointerDown），禁止 click/mousedown
 * 5. 抢焦区 / 命令壳 → FocusGate（data-ww-focus-hog / data-ww-chrome）
 *
 * 套其他框架示例：
 *   import { pressProps, Select } from '../../components/compat'
 *   <AntButton {...pressProps(onSave)}>保存</AntButton>
 *   <Select className="ant-like" ... />
 */
export { pressProps, type PressHandler, type PressOptions } from './press'
export { useOutsideDismiss } from './useOutsideDismiss'
export { useDismissOnPointerDown, onPointerDownOutside } from './useDismissOnPointerDown'
export { dismissOverlays, subscribeDismissOverlays, DISMISS_OVERLAYS_EVENT } from './dismissOverlays'
export { useDismissOverlays } from './useDismissOverlays'
export { Select, type SelectOption, type SelectGroup } from './Select'
export { ModalPortal } from './ModalPortal'
export {
  installFocusGate,
  registerFocusHog,
  chromeProps,
  focusHogProps,
  FOCUS_HOG_ATTR,
  CHROME_ATTR,
} from './focusGate'

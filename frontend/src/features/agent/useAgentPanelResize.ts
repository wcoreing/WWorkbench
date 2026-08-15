import { useResizable } from '../../components/layout'

/** useAgentPanelResize AI 侧栏宽度拖拽。 */
export function useAgentPanelResize() {
  const { size: width, onResizeStart } = useResizable({
    axis: 'x',
    storageKey: 'agent_panel_width',
    defaultSize: 360,
    min: 280,
    max: 720,
    invert: true,
  })
  return { width, onResizeStart }
}

import { DEFAULT_UI_FONT_SIZE } from '../../shell/uiFontSize'

/**
 * zoomCompensatedPx — 壳层 CSS zoom 反缩放后，内容字号需乘以 zoom 才能视觉不变。
 * 宿主需同时加 class `ww-zoom-content`。
 */
export function zoomCompensatedPx(basePx: number, uiFontSize: number): number {
  return Math.max(10, Math.round(basePx * (uiFontSize / DEFAULT_UI_FONT_SIZE)))
}

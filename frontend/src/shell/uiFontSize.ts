/** 界面字号档位（基准 12px → --ui-scale；结构 token 随密度缩放，禁止整壳 CSS zoom）。 */
export const UI_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24] as const
export type UiFontSize = (typeof UI_FONT_SIZES)[number]
export const DEFAULT_UI_FONT_SIZE: UiFontSize = 12

/** clampUiFontSize 将字号限制到可用档位（就近）。 */
export function clampUiFontSize(value: number): UiFontSize {
  const n = Math.round(value)
  if ((UI_FONT_SIZES as readonly number[]).includes(n)) return n as UiFontSize
  let best: UiFontSize = UI_FONT_SIZES[0]
  let bestDist = Math.abs(n - best)
  for (const size of UI_FONT_SIZES) {
    const d = Math.abs(n - size)
    if (d < bestDist) {
      best = size
      bestDist = d
    }
  }
  return best
}

/** uiScaleFromFontSize 字号 → 密度倍率（12 → 1）。 */
export function uiScaleFromFontSize(px: number): number {
  return clampUiFontSize(px) / DEFAULT_UI_FONT_SIZE
}

/** applyUiFontSize 写入 --ui-scale（驱动 tokens），不再使用 CSS zoom。 */
export function applyUiFontSize(px: number) {
  const size = clampUiFontSize(px)
  const scale = size / DEFAULT_UI_FONT_SIZE
  document.documentElement.style.setProperty('--ui-scale', String(scale))
  document.documentElement.style.setProperty('--ui-font-size', `${size}px`)
  document.documentElement.setAttribute('data-ui-font-size', String(size))
  document.documentElement.removeAttribute('data-ui-zoomed')
  document.documentElement.style.removeProperty('--ui-zoom')
  return size
}

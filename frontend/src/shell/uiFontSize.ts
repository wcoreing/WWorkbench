/** 界面字号档位（基准 12px，经 --ui-zoom 缩放整壳）。 */
export const UI_FONT_SIZES = [11, 12, 13, 14, 15, 16] as const
export type UiFontSize = (typeof UI_FONT_SIZES)[number]
export const DEFAULT_UI_FONT_SIZE: UiFontSize = 12

/** clampUiFontSize 将字号限制到可用档位。 */
export function clampUiFontSize(value: number): UiFontSize {
  const n = Math.round(value)
  if ((UI_FONT_SIZES as readonly number[]).includes(n)) return n as UiFontSize
  if (n < UI_FONT_SIZES[0]) return UI_FONT_SIZES[0]
  return UI_FONT_SIZES[UI_FONT_SIZES.length - 1]
}

/** applyUiFontSize 把字号写到 document（zoom + CSS 变量）。 */
export function applyUiFontSize(px: number) {
  const size = clampUiFontSize(px)
  document.documentElement.style.setProperty('--ui-zoom', String(size / DEFAULT_UI_FONT_SIZE))
  document.documentElement.style.setProperty('--ui-font-size', `${size}px`)
  document.documentElement.setAttribute('data-ui-font-size', String(size))
  return size
}

const OVERLAY_ROOT_ID = 'wwb-overlay-root'

/** getWorkbenchOverlayRoot 壳内弹层根（层叠方便）；未挂载时退回 body。 */
export function getWorkbenchOverlayRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('document unavailable')
  }
  return document.getElementById(OVERLAY_ROOT_ID) || document.body
}

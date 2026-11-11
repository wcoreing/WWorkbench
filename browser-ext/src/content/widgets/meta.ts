/** 填表结果元数据（蒸馏剧本时可升级为稳定 selector）。 */
export function fillResultMeta(el, extra = {}) {
  const id = (el?.getAttribute?.('id') || '').trim()
  const name = (el?.getAttribute?.('name') || '').trim()
  return {
    tag: el?.tagName?.toLowerCase?.() || '',
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...extra,
  }
}

/** 控件失败时统一提示：先 snapshot 再点 ref。 */
export const SNAPSHOT_HINT = 'snapshot_then_click'

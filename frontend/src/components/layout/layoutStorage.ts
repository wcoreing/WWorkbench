/** 布局分栏尺寸 / 折叠状态持久化 */

export type SizeMap = Record<string, number>
export type CollapsedMap = Record<string, boolean>

export function loadSizeMap(key: string): SizeMap {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SizeMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveSizeMap(key: string, sizes: SizeMap) {
  try {
    localStorage.setItem(key, JSON.stringify(sizes))
  } catch {
    /* ignore */
  }
}

export function collapsedStorageKey(storageKey: string) {
  return `${storageKey}__collapsed`
}

export function loadCollapsedMap(storageKey: string): CollapsedMap {
  try {
    const raw = localStorage.getItem(collapsedStorageKey(storageKey))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CollapsedMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveCollapsedMap(storageKey: string, collapsed: CollapsedMap) {
  try {
    localStorage.setItem(collapsedStorageKey(storageKey), JSON.stringify(collapsed))
  } catch {
    /* ignore */
  }
}

/** 记忆展开态外层尺寸，供收起后再展开还原 */
export function rememberScalarSize(key: string, size: number) {
  try {
    localStorage.setItem(key, String(Math.round(size)))
  } catch {
    /* ignore */
  }
}

export function recallScalarSize(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) ?? '', 10)
    if (Number.isFinite(v)) return Math.min(max, Math.max(min, v))
  } catch {
    /* ignore */
  }
  return Math.min(max, Math.max(min, fallback))
}


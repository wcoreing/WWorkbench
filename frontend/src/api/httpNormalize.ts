import type { HTTPFolder, HTTPSavedRequest } from './types'

/** pickStr 从对象读取字符串字段（兼容多种命名）。 */
function pickStr(raw: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

/** pickNum 从对象读取数字字段。 */
function pickNum(raw: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'number' && !Number.isNaN(v)) return v
  }
  return fallback
}

/** normalizeHTTPSavedRequest 规范化列表项（兼容 Wails 字段名差异）。 */
export function normalizeHTTPSavedRequest(raw: unknown): HTTPSavedRequest {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    id: pickStr(r, ['id', 'ID']),
    folderId: pickStr(r, ['folderId', 'folder_id', 'FolderID']),
    name: pickStr(r, ['name', 'Name']),
    method: pickStr(r, ['method', 'Method']) || 'GET',
    url: pickStr(r, ['url', 'URL']),
    paramsJson: pickStr(r, ['paramsJson', 'params_json', 'ParamsJSON']) || '[]',
    headersJson: pickStr(r, ['headersJson', 'headers_json', 'HeadersJSON']) || '[]',
    cookiesJson: pickStr(r, ['cookiesJson', 'cookies_json', 'CookiesJSON']) || '[]',
    body: pickStr(r, ['body', 'Body']),
    notes: pickStr(r, ['notes', 'Notes']),
    sortOrder: pickNum(r, ['sortOrder', 'sort_order', 'SortOrder']),
    createdAt: pickNum(r, ['createdAt', 'created_at', 'CreatedAt']),
    updatedAt: pickNum(r, ['updatedAt', 'updated_at', 'UpdatedAt']),
  }
}

/** normalizeHTTPFolder 规范化目录项。 */
export function normalizeHTTPFolder(raw: unknown): HTTPFolder {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    id: pickStr(r, ['id', 'ID']),
    name: pickStr(r, ['name', 'Name']),
    parentId: pickStr(r, ['parentId', 'parent_id', 'ParentID']),
    sortOrder: pickNum(r, ['sortOrder', 'sort_order', 'SortOrder']),
    createdAt: pickNum(r, ['createdAt', 'created_at', 'CreatedAt']),
    updatedAt: pickNum(r, ['updatedAt', 'updated_at', 'UpdatedAt']),
  }
}

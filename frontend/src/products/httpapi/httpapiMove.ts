import { api } from '../../api/client'
import type { HTTPFolder, HTTPSavedRequest } from '../../api/types'
import { model } from '../../../wailsjs/go/models'
import {
  applyHttpTreeDrop,
  buildHttpApiTreeLayout,
  type HttpDragPayload,
  type HttpDropTarget,
} from './httpapiSort'

/** shouldSkipHttpApiFolderMove 是否已在目标目录（无需请求后端）。 */
export function shouldSkipHttpApiFolderMove(
  items: HTTPSavedRequest[],
  apiId: string,
  folderId: string,
): boolean {
  const item = items.find((i) => i.id === apiId)
  if (!item) return true
  return (item.folderId || '') === (folderId || '')
}

/** persistMoveHttpApiToFolder 将接口移入目录（folderId 为空表示根目录）。 */
export async function persistMoveHttpApiToFolder(apiId: string, folderId: string): Promise<void> {
  await api.moveHTTPRequestToFolder(apiId, folderId || '')
}

/** persistHttpApiTreeLayout 持久化侧栏树布局。 */
export async function persistHttpApiTreeLayout(layout: Record<string, string[]>): Promise<void> {
  await api.applyHTTPApiTreeLayout(
    model.HTTPApiTreeLayoutDO.createFrom({ childrenByParent: layout }),
  )
}

/** persistHttpTreeDrop 计算拖放布局并提交后端。 */
export async function persistHttpTreeDrop(
  folders: HTTPFolder[],
  items: HTTPSavedRequest[],
  drag: HttpDragPayload,
  target: HttpDropTarget,
): Promise<Record<string, string[]> | null> {
  const layout = applyHttpTreeDrop(folders, items, drag, target)
  if (!layout) return null
  const prev = JSON.stringify(buildHttpApiTreeLayout(folders, items))
  const next = JSON.stringify(layout)
  if (prev === next) return null
  await persistHttpApiTreeLayout(layout)
  return layout
}

import type { DragEvent } from 'react'
import type { AgentMention, AgentMentionKind } from './agentMention'
import { openAgentDraft } from './openAgentDraft'

/** 统一资产拖入 AI 侧栏的 MIME（全产品共用）。 */
export const ASSET_DRAG_MIME = 'application/x-wworkbench-asset'

/** WorkbenchAssetRef 可绑定到 Agent 的资产引用（与 AgentMention 同形）。 */
export type WorkbenchAssetRef = AgentMention

type AssetDragPayload = {
  v: 1
  assets: WorkbenchAssetRef[]
}

/** isAssetKind 校验 kind。 */
function isAssetKind(k: unknown): k is AgentMentionKind {
  return (
    k === 'ssh' ||
    k === 'database' ||
    k === 'docker' ||
    k === 'log' ||
    k === 'http' ||
    k === 'note'
  )
}

/** normalizeAssets 清洗并去重。 */
function normalizeAssets(list: WorkbenchAssetRef[]): WorkbenchAssetRef[] {
  const seen = new Set<string>()
  const out: WorkbenchAssetRef[] = []
  for (const a of list) {
    if (!a || !isAssetKind(a.kind) || !String(a.id || '').trim()) continue
    const id = String(a.id).trim()
    const key = `${a.kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: a.kind,
      id,
      label: (a.label || '').trim() || id,
      sublabel: a.sublabel?.trim() || undefined,
    })
  }
  return out
}

/** beginAssetDrag 在拖拽源写入统一资产载荷（可与产品内 MIME 并存）。 */
export function beginAssetDrag(
  e: DragEvent,
  asset: WorkbenchAssetRef | WorkbenchAssetRef[],
  opts?: { effectAllowed?: DataTransfer['effectAllowed'] },
): void {
  const assets = normalizeAssets(Array.isArray(asset) ? asset : [asset])
  if (!assets.length) return
  const payload: AssetDragPayload = { v: 1, assets }
  e.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload))
  // 纯文本兜底（部分 WebView 对自定义 MIME 不友好）
  e.dataTransfer.setData(
    'text/plain',
    assets.map((a) => `@${a.kind}:${a.id}`).join(' '),
  )
  e.dataTransfer.effectAllowed = opts?.effectAllowed ?? 'copy'
}

/** transferHasAssetDrag 悬停时是否带有统一资产载荷。 */
export function transferHasAssetDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types || []).includes(ASSET_DRAG_MIME)
}

/** readAssetDrag 从 drop 读取资产列表。 */
export function readAssetDrag(dt: DataTransfer | null): WorkbenchAssetRef[] {
  if (!dt) return []
  const raw = dt.getData(ASSET_DRAG_MIME) || ''
  if (!raw.trim()) return []
  try {
    const o = JSON.parse(raw) as AssetDragPayload
    if (!o || o.v !== 1 || !Array.isArray(o.assets)) return []
    return normalizeAssets(o.assets)
  } catch {
    return []
  }
}

/** bindAssetsToAgent 打开 AI 侧栏并绑定资产（拖放 / 按钮共用）；通知由调用方按 i18n 发。 */
export function bindAssetsToAgent(assets: WorkbenchAssetRef | WorkbenchAssetRef[]): WorkbenchAssetRef[] {
  const list = normalizeAssets(Array.isArray(assets) ? assets : [assets])
  if (!list.length) return []
  openAgentDraft({ mentions: list })
  return list
}

/** 拖拽刚结束时忽略随后 click（避免拖完又打开/选中）。 */
let lastAssetDragAt = 0
const ASSET_DRAG_CLICK_GUARD_MS = 450

/**
 * assetDragHandlers 仅拖拽（可与自有 onClick 组合）。
 * 注意：同一节点不要再用 pressProps——其 pointerdown.preventDefault 会掐死 HTML5 拖拽。
 */
export function assetDragHandlers(
  asset: WorkbenchAssetRef | WorkbenchAssetRef[],
  opts?: { effectAllowed?: DataTransfer['effectAllowed'] },
): {
  draggable: true
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
} {
  return {
    draggable: true,
    onDragStart: (e) => {
      lastAssetDragAt = Date.now()
      beginAssetDrag(e, asset, opts)
    },
    onDragEnd: () => {
      lastAssetDragAt = Date.now()
    },
  }
}

/**
 * assetDragRowProps 列表行：拖入 AI + 单击激活。
 * 用 onClick 而非 pressProps，保证可拖。
 */
export function assetDragRowProps(
  asset: WorkbenchAssetRef | WorkbenchAssetRef[],
  onActivate: () => void,
  opts?: { effectAllowed?: DataTransfer['effectAllowed'] },
): {
  draggable: true
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onClick: () => void
} {
  const drag = assetDragHandlers(asset, opts)
  return {
    ...drag,
    onClick: () => {
      if (Date.now() - lastAssetDragAt < ASSET_DRAG_CLICK_GUARD_MS) return
      onActivate()
    },
  }
}

import { EventsOn } from '../../wailsjs/runtime/runtime'
import { useAppStore } from '../stores/appStore'
import type { ProductId } from '../shell/products'

/** WorkbenchChangedEvent 资产雷达事件（对齐 agentdesk workspace-changed，载体为 SQLite 资产）。 */
export type WorkbenchChangedEvent = {
  domain: string
  op: string
  ids: string[]
  writeId?: string
  reveal?: boolean
  product?: string
  label?: string
}

type Listener = (evt: WorkbenchChangedEvent) => void

const listeners = new Set<Listener>()
let started = false
let unsubRuntime: (() => void) | undefined
/** 按 domain 暂存最近变更：产品尚未挂载时由工作台 mount 后 drain。 */
const pendingByDomain = new Map<string, WorkbenchChangedEvent>()

function normalize(raw: Record<string, unknown>): WorkbenchChangedEvent {
  const idsRaw = raw.ids
  const ids = Array.isArray(idsRaw) ? idsRaw.map((x) => String(x)).filter(Boolean) : []
  return {
    domain: String(raw.domain ?? ''),
    op: String(raw.op ?? ''),
    ids,
    writeId: raw.writeId ? String(raw.writeId) : undefined,
    reveal: Boolean(raw.reveal),
    product: raw.product ? String(raw.product) : undefined,
    label: raw.label ? String(raw.label) : undefined,
  }
}

/** subscribeWorkbenchChanged 订阅资产变更（产品工作台挂载时注册）。 */
export function subscribeWorkbenchChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** takePendingWorkbenchChanged 取出匹配域前缀的全部 pending（mount 时补消化）。 */
export function takePendingWorkbenchChanged(domainPrefix: string): WorkbenchChangedEvent[] {
  const out: WorkbenchChangedEvent[] = []
  for (const [domain, evt] of pendingByDomain) {
    if (!domain.startsWith(domainPrefix)) continue
    pendingByDomain.delete(domain)
    out.push(evt)
  }
  return out
}

/** startWorkbenchRadar 全局启动一次 Wails 事件桥。 */
export function startWorkbenchRadar(): () => void {
  if (started) {
    return () => {}
  }
  started = true
  unsubRuntime = EventsOn('workbench-changed', (raw: Record<string, unknown>) => {
    const evt = normalize(raw || {})
    if (!evt.domain) return
    pendingByDomain.set(evt.domain, evt)
    if (evt.reveal && evt.product) {
      useAppStore.getState().setActiveProduct(evt.product as ProductId)
    }
    for (const fn of listeners) {
      try {
        fn(evt)
      } catch (e) {
        console.error('workbench radar listener', e)
      }
    }
  })
  return () => {
    unsubRuntime?.()
    unsubRuntime = undefined
    started = false
    listeners.clear()
    pendingByDomain.clear()
  }
}

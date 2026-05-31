import type { ProductLinkRequest } from '../stores/appStore'

/** payloadStr 读取字符串字段。 */
export function payloadStr(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key]
  if (v == null) return undefined
  const s = String(v).trim()
  return s || undefined
}

/** payloadBool 读取布尔字段。 */
export function payloadBool(payload: Record<string, unknown>, key: string): boolean {
  return Boolean(payload[key])
}

/** linkToCommandPayload 兼容旧 ProductLink 调用。 */
export function linkToCommandPayload(link: ProductLinkRequest): Record<string, unknown> {
  return {
    hostId: link.hostId,
    connectionId: link.connectionId,
    localShell: link.localShell,
    initialCommand: link.initialCommand,
    initialSql: link.initialSql,
    runSql: link.runSql,
    connectionDraft: link.connectionDraft,
  }
}

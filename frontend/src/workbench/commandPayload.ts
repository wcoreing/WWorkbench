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

/** payloadObj 读取对象字段。 */
export function payloadObj(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = payload[key]
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return undefined
  return v as Record<string, unknown>
}

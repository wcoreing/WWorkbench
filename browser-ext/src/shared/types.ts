export type OkResult<T = unknown> = { ok: true; data: T }
/** 兼容旧客户端：error 仍是 string；结构化时附带 code。 */
export type ErrResult = { ok: false; error: string; code?: string }
export type CmdResult<T = unknown> = OkResult<T> | ErrResult

export type BridgeCommand = {
  id?: string
  action: string
  args?: Record<string, unknown>
  /** Kimi 风格：同一任务共用 session，便于日后标签分组。 */
  session?: string
}

export function fail(message: string, code = 'error'): ErrResult {
  return { ok: false, error: message, code }
}

export function ok<T>(data: T): OkResult<T> {
  return { ok: true, data }
}

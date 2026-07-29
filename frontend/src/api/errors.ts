/** API 调用错误，携带业务错误码。 */
export class ApiCallError extends Error {
  code: string
  detail?: string

  constructor(message: string, code: string, detail?: string) {
    super(message)
    this.name = 'ApiCallError'
    this.code = code
    this.detail = detail
  }
}

/** extractSSHFingerprint 从错误文本提取 SHA256 指纹。 */
function extractSSHFingerprint(err: ApiCallError): string | undefined {
  const text = `${err.message} ${err.detail ?? ''}`
  return text.match(/SHA256:[A-Za-z0-9+/=]+/)?.[0]
}

/** isSSHHostUnknown 是否未知 SSH 主机密钥。 */
export function isSSHHostUnknown(err: unknown): err is ApiCallError {
  if (!(err instanceof ApiCallError)) return false
  if (err.code === 'SSH_HOST_UNKNOWN') return true
  const blob = `${err.message} ${err.detail ?? ''}`
  return blob.includes('SSH_HOST_UNKNOWN')
}

/** sshHostUnknownFingerprint 获取未知主机密钥指纹。 */
export function sshHostUnknownFingerprint(err: ApiCallError): string | undefined {
  if (!isSSHHostUnknown(err)) return undefined
  if (err.detail?.startsWith('SHA256:')) return err.detail
  return extractSSHFingerprint(err)
}

/** isInvalidSortColumn 表数据排序列校验失败。 */
export function isInvalidSortColumn(err: unknown): err is ApiCallError {
  if (!(err instanceof ApiCallError)) return false
  if (err.code === 'INVALID_ARG' && err.message.includes('无效的排序列')) return true
  return err.message.includes('无效的排序列')
}

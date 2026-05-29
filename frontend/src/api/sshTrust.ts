import { api } from './client'
import { ApiCallError, isSSHHostUnknown, sshHostUnknownFingerprint } from './errors'

export type SSHTrustConfirm = (fingerprint?: string) => Promise<boolean>

/** withSSHHostTrust 遇未知主机密钥时提示信任并重试。 */
export async function withSSHHostTrust<T>(
  host: string,
  port: number,
  action: () => Promise<T>,
  confirmTrust: SSHTrustConfirm
): Promise<T> {
  try {
    return await action()
  } catch (err) {
    if (!isSSHHostUnknown(err)) throw err
    if (!(await confirmTrust(sshHostUnknownFingerprint(err)))) throw err
    await api.trustSSHHost(host, port)
    return action()
  }
}

export { ApiCallError, isSSHHostUnknown }

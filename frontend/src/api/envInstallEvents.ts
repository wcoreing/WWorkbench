import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { RuntimeLang } from './types'

export interface EnvInstallLogEvent {
  lang: RuntimeLang | string
  line: string
}

/** onEnvInstallLog 订阅环境安装日志。 */
export function onEnvInstallLog(handler: (evt: EnvInstallLogEvent) => void): () => void {
  return EventsOn('env:install-log', (raw: Record<string, unknown>) => {
    handler({
      lang: String(raw.lang ?? raw.Lang ?? ''),
      line: String(raw.line ?? raw.Line ?? ''),
    })
  })
}

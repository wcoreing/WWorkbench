import { EventsOn } from '../../wailsjs/runtime/runtime'
import type { RuntimeLang } from './types'

export interface EnvInstallLogEvent {
  lang: RuntimeLang | string
  line: string
  /** true 时覆盖上一行（对应终端 \r 进度刷新） */
  replaceLast?: boolean
}

/** onEnvInstallLog 订阅环境安装日志。 */
export function onEnvInstallLog(handler: (evt: EnvInstallLogEvent) => void): () => void {
  return EventsOn('env:install-log', (raw: Record<string, unknown>) => {
    const replaceRaw = raw.replaceLast ?? raw.ReplaceLast
    handler({
      lang: String(raw.lang ?? raw.Lang ?? ''),
      line: String(raw.line ?? raw.Line ?? ''),
      replaceLast: replaceRaw === true || replaceRaw === 'true' || replaceRaw === 1,
    })
  })
}

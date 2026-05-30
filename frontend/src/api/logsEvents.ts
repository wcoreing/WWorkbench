import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface LogsChunkEvent {
  streamId: string
  chunk: string
  reset: boolean
}

/** subscribeLogsChunks 订阅日志跟随增量事件。 */
export function subscribeLogsChunks(handler: (evt: LogsChunkEvent) => void) {
  return EventsOn('logs:chunk', (raw: Record<string, unknown>) => {
    handler({
      streamId: String(raw.streamId ?? ''),
      chunk: String(raw.chunk ?? ''),
      reset: Boolean(raw.reset),
    })
  })
}

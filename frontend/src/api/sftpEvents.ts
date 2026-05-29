import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface SftpProgressEvent {
  taskId: string
  sessionId: string
  kind: 'upload' | 'download' | string
  name: string
  done: number
  total: number
  state: 'running' | 'done' | 'error' | string
}

/** onSftpProgress 订阅 SFTP 传输进度。 */
export function onSftpProgress(handler: (evt: SftpProgressEvent) => void): () => void {
  return EventsOn('sftp:progress', (raw: Record<string, unknown>) => {
    handler({
      taskId: String(raw.taskId ?? raw.TaskID ?? ''),
      sessionId: String(raw.sessionId ?? raw.SessionID ?? ''),
      kind: String(raw.kind ?? raw.Kind ?? ''),
      name: String(raw.name ?? raw.Name ?? ''),
      done: Number(raw.done ?? raw.Done ?? 0),
      total: Number(raw.total ?? raw.Total ?? 0),
      state: String(raw.state ?? raw.State ?? ''),
    })
  })
}

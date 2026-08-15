import { EventsOn } from '../../wailsjs/runtime/runtime'

export interface SQLExportProgressEvent {
  taskId: string
  database: string
  table: string
  done: number
  total: number
  state: 'running' | 'done' | 'error' | 'cancelled' | string
  message: string
}

/** onSQLExportProgress 订阅数据库 SQL 导出进度。 */
export function onSQLExportProgress(handler: (evt: SQLExportProgressEvent) => void): () => void {
  return EventsOn('db:export-progress', (raw: Record<string, unknown>) => {
    handler({
      taskId: String(raw.taskId ?? raw.TaskID ?? ''),
      database: String(raw.database ?? raw.Database ?? ''),
      table: String(raw.table ?? raw.Table ?? ''),
      done: Number(raw.done ?? raw.Done ?? 0),
      total: Number(raw.total ?? raw.Total ?? 0),
      state: String(raw.state ?? raw.State ?? ''),
      message: String(raw.message ?? raw.Message ?? ''),
    })
  })
}

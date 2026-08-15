import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { onSQLExportProgress, type SQLExportProgressEvent } from '../../api/dbExportEvents'

const EXPORT_SQL_MAX_ROWS = 100000

export type SQLExportProgress = SQLExportProgressEvent

function isExportCancelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /CANCELLED|已取消/.test(msg)
}

/** useSQLExport 管理 SQL 导出进度与取消。 */
export function useSQLExport(onStatus: (message: string) => void) {
  const [progress, setProgress] = useState<SQLExportProgress | null>(null)
  const cancelledRef = useRef<Set<string>>(new Set())
  const activeTaskRef = useRef<string | null>(null)

  useEffect(() => {
    return onSQLExportProgress((evt) => {
      if (!evt.taskId || activeTaskRef.current !== evt.taskId) return
      if (cancelledRef.current.has(evt.taskId) && evt.state === 'running') return
      setProgress(evt)
      if (evt.state === 'done' || evt.state === 'error' || evt.state === 'cancelled') {
        activeTaskRef.current = null
      }
    })
  }, [])

  const cancel = useCallback(() => {
    const taskId = activeTaskRef.current
    if (!taskId) return
    cancelledRef.current.add(taskId)
    setProgress((prev) =>
      prev && prev.taskId === taskId
        ? { ...prev, state: 'cancelled', message: '已取消导出' }
        : prev,
    )
    void api.cancelSQLExport(taskId).catch(() => {})
  }, [])

  const runExport = useCallback(
    async (
      kind: 'table' | 'database',
      sessionId: string,
      database: string,
      table: string | undefined,
      exportingLabel: string,
      exportedLabel: (path: string) => string,
      cancelledLabel: string,
    ) => {
      const taskId = crypto.randomUUID()
      activeTaskRef.current = taskId
      cancelledRef.current.delete(taskId)
      setProgress({
        taskId,
        database,
        table: table ?? '',
        done: 0,
        total: kind === 'table' ? 1 : 0,
        state: 'running',
        message: table || database,
      })
      onStatus(exportingLabel)
      try {
        const path =
          kind === 'table'
            ? await api.exportTableSQL(sessionId, database, table!, taskId, EXPORT_SQL_MAX_ROWS)
            : await api.exportDatabaseSQL(sessionId, database, taskId, EXPORT_SQL_MAX_ROWS)
        if (cancelledRef.current.has(taskId)) {
          onStatus(cancelledLabel)
          setProgress(null)
          return ''
        }
        if (path) onStatus(exportedLabel(path))
        else onStatus('')
        setProgress(null)
        return path
      } catch (e) {
        if (cancelledRef.current.has(taskId) || isExportCancelError(e)) {
          onStatus(cancelledLabel)
          setProgress((prev) =>
            prev && prev.taskId === taskId
              ? { ...prev, state: 'cancelled', message: cancelledLabel }
              : prev,
          )
          setTimeout(() => setProgress(null), 800)
          return ''
        }
        onStatus((e as Error).message)
        setProgress(null)
        throw e
      } finally {
        if (activeTaskRef.current === taskId) activeTaskRef.current = null
        cancelledRef.current.delete(taskId)
      }
    },
    [onStatus],
  )

  const exportTableSQL = useCallback(
    (sessionId: string, database: string, table: string, labels: {
      exporting: string
      exported: (path: string) => string
      cancelled: string
    }) => runExport('table', sessionId, database, table, labels.exporting, labels.exported, labels.cancelled),
    [runExport],
  )

  const exportDatabaseSQL = useCallback(
    (sessionId: string, database: string, labels: {
      exporting: string
      exported: (path: string) => string
      cancelled: string
    }) => runExport('database', sessionId, database, undefined, labels.exporting, labels.exported, labels.cancelled),
    [runExport],
  )

  return {
    progress,
    exporting: !!progress && progress.state === 'running',
    cancel,
    exportTableSQL,
    exportDatabaseSQL,
  }
}

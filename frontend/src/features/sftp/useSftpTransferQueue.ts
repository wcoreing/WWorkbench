import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { onSftpProgress } from '../../api/sftpEvents'

export type TransferKind = 'upload' | 'download'
export type TransferState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface TransferTask {
  id: string
  kind: TransferKind
  sessionId: string
  sourcePath: string
  targetDir: string
  name: string
  state: TransferState
  done: number
  total: number
  error?: string
}

const MAX_CONCURRENT = 3

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

/** countInFlight 正在占用并发槽的任务数（running ∪ starting，去重） */
function countInFlight(tasks: TransferTask[], starting: Set<string>): number {
  const ids = new Set<string>()
  for (const t of tasks) {
    if (t.state === 'running') ids.add(t.id)
  }
  for (const id of starting) ids.add(id)
  return ids.size
}

/** isTransferring 是否仍有排队或进行中的任务 */
function isTransferring(tasks: TransferTask[], starting: Set<string>): boolean {
  return tasks.some((t) => t.state === 'queued' || t.state === 'running') || starting.size > 0
}

/** useSftpTransferQueue SFTP 传输队列（最多 3 路并发，支持取消） */
export function useSftpTransferQueue(onIdle?: () => void) {
  const [tasks, setTasks] = useState<TransferTask[]>([])
  const tasksRef = useRef<TransferTask[]>([])
  const startingRef = useRef<Set<string>>(new Set())
  const cancelledRef = useRef<Set<string>>(new Set())
  const onIdleRef = useRef(onIdle)

  useEffect(() => {
    onIdleRef.current = onIdle
  }, [onIdle])

  /** commitTasks 先写 tasksRef 再 setState，保证 pump/onIdle 立刻看到最新队列 */
  const commitTasks = useCallback((updater: (prev: TransferTask[]) => TransferTask[]) => {
    const next = updater(tasksRef.current)
    tasksRef.current = next
    setTasks(next)
  }, [])

  useEffect(
    () =>
      onSftpProgress((evt) => {
        if (!evt.taskId || cancelledRef.current.has(evt.taskId)) return
        commitTasks((prev) =>
          prev.map((t) => {
            if (t.id !== evt.taskId || t.state === 'cancelled') return t
            const next: TransferTask = {
              ...t,
              done: evt.done,
              total: evt.total > 0 ? evt.total : t.total,
              name: evt.name || t.name,
            }
            if (evt.state === 'done') next.state = 'done'
            if (evt.state === 'error') {
              if (cancelledRef.current.has(evt.taskId)) {
                next.state = 'cancelled'
                next.error = '已取消'
              } else {
                next.state = 'error'
                next.error = '传输失败'
              }
            }
            if (evt.state === 'running') next.state = 'running'
            return next
          })
        )
      }),
    [commitTasks]
  )

  const pump = useCallback(() => {
    const current = tasksRef.current
    const slots = MAX_CONCURRENT - countInFlight(current, startingRef.current)
    if (slots <= 0) return
    current
      .filter((t) => t.state === 'queued' && !startingRef.current.has(t.id) && !cancelledRef.current.has(t.id))
      .slice(0, slots)
      .forEach((task) => {
        startingRef.current.add(task.id)
        commitTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'running' } : t)))
        const run = async () => {
          try {
            if (cancelledRef.current.has(task.id)) {
              commitTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'cancelled' } : t)))
              return
            }
            if (task.kind === 'upload') {
              await api.transferSFTPUpload(task.sessionId, task.id, task.sourcePath, task.targetDir)
            } else {
              await api.transferSFTPDownload(task.sessionId, task.id, task.sourcePath, task.targetDir)
            }
            if (cancelledRef.current.has(task.id)) {
              commitTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'cancelled' } : t)))
              return
            }
            commitTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'done' } : t)))
          } catch (e) {
            const msg = (e as Error).message
            const cancelled = cancelledRef.current.has(task.id) || msg.includes('取消')
            commitTasks((prev) =>
              prev.map((t) =>
                t.id === task.id ? { ...t, state: cancelled ? 'cancelled' : 'error', error: msg } : t
              )
            )
          } finally {
            startingRef.current.delete(task.id)
            setTimeout(() => {
              pump()
              if (!isTransferring(tasksRef.current, startingRef.current)) {
                onIdleRef.current?.()
              }
            }, 0)
          }
        }
        run()
      })
  }, [commitTasks])

  const enqueue = useCallback(
    (kind: TransferKind, sessionId: string, paths: string[], targetDir: string) => {
      if (!paths.length) return
      const newTasks: TransferTask[] = paths.map((sourcePath) => ({
        id: crypto.randomUUID(),
        kind,
        sessionId,
        sourcePath,
        targetDir,
        name: basename(sourcePath),
        state: 'queued',
        done: 0,
        total: 0,
      }))
      commitTasks((prev) => [...prev, ...newTasks])
      setTimeout(pump, 0)
    },
    [commitTasks, pump]
  )

  const cancelTask = useCallback(
    (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId)
      if (!task || task.state === 'done' || task.state === 'cancelled') return
      cancelledRef.current.add(taskId)
      if (task.state === 'queued') {
        commitTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, state: 'cancelled', error: '已取消' } : t))
        )
        cancelledRef.current.delete(taskId)
        setTimeout(pump, 0)
        return
      }
      api.cancelSFTPTask(taskId).catch(() => {})
      commitTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, state: 'cancelled', error: '已取消' } : t)))
      setTimeout(pump, 0)
    },
    [commitTasks, pump]
  )

  const activeCount = tasks.filter((t) => t.state === 'queued' || t.state === 'running').length
  const queuedCount = tasks.filter((t) => t.state === 'queued').length
  const runningCount = tasks.filter((t) => t.state === 'running').length

  const clearFinished = useCallback(() => {
    commitTasks((prev) => prev.filter((t) => t.state === 'queued' || t.state === 'running'))
  }, [commitTasks])

  return {
    tasks,
    activeCount,
    queuedCount,
    runningCount,
    enqueueUpload: (sessionId: string, paths: string[], remoteDir: string) =>
      enqueue('upload', sessionId, paths, remoteDir),
    enqueueDownload: (sessionId: string, paths: string[], localDir: string) =>
      enqueue('download', sessionId, paths, localDir),
    cancelTask,
    clearFinished,
  }
}

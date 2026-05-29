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

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(
    () =>
      onSftpProgress((evt) => {
        if (!evt.taskId || cancelledRef.current.has(evt.taskId)) return
        setTasks((prev) =>
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
    []
  )

  const pump = useCallback(() => {
    const current = tasksRef.current
    const running = current.filter((t) => t.state === 'running').length + startingRef.current.size
    const slots = MAX_CONCURRENT - running
    if (slots <= 0) return
    current
      .filter((t) => t.state === 'queued' && !startingRef.current.has(t.id) && !cancelledRef.current.has(t.id))
      .slice(0, slots)
      .forEach((task) => {
        startingRef.current.add(task.id)
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'running' } : t)))
        const run = async () => {
          try {
            if (cancelledRef.current.has(task.id)) {
              setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'cancelled' } : t)))
              return
            }
            if (task.kind === 'upload') {
              await api.transferSFTPUpload(task.sessionId, task.id, task.sourcePath, task.targetDir)
            } else {
              await api.transferSFTPDownload(task.sessionId, task.id, task.sourcePath, task.targetDir)
            }
            if (cancelledRef.current.has(task.id)) {
              setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'cancelled' } : t)))
              return
            }
            setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: 'done' } : t)))
            setTimeout(() => setTasks((prev) => prev.filter((t) => t.id !== task.id)), 3000)
          } catch (e) {
            const msg = (e as Error).message
            const cancelled = cancelledRef.current.has(task.id) || msg.includes('取消')
            setTasks((prev) =>
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
  }, [])

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
      setTasks((prev) => {
        const next = [...prev, ...newTasks]
        tasksRef.current = next
        return next
      })
      setTimeout(pump, 0)
    },
    [pump]
  )

  const cancelTask = useCallback(
    (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId)
      if (!task || task.state === 'done' || task.state === 'cancelled') return
      cancelledRef.current.add(taskId)
      if (task.state === 'queued') {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        cancelledRef.current.delete(taskId)
        return
      }
      api.cancelSFTPTask(taskId).catch(() => {})
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, state: 'cancelled', error: '已取消' } : t)))
      setTimeout(() => setTasks((prev) => prev.filter((t) => t.id !== taskId)), 2000)
    },
    []
  )

  const activeCount = tasks.filter((t) => t.state === 'queued' || t.state === 'running').length
  const queuedCount = tasks.filter((t) => t.state === 'queued').length
  const runningCount = tasks.filter((t) => t.state === 'running').length

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.state === 'queued' || t.state === 'running'))
  }, [])

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
